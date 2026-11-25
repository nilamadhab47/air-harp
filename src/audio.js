import { CONFIG } from "./config.js";

export class Synth {
  constructor() {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = CONFIG.masterGain;

    // Light reverb-ish tail via feedback delay + compressor to avoid clipping.
    const comp = this.ctx.createDynamicsCompressor();
    const delay = this.ctx.createDelay();
    delay.delayTime.value = 0.18;
    this.reverbFb = this.ctx.createGain();
    this.reverbWet = this.ctx.createGain();
    this.master.connect(comp);
    this.master.connect(delay);
    delay.connect(this.reverbFb).connect(delay);
    delay.connect(this.reverbWet).connect(comp);
    comp.threshold.value = CONFIG.compThreshold;
    comp.knee.value = CONFIG.compKnee;
    comp.ratio.value = CONFIG.compRatio;
    comp.attack.value = CONFIG.compAttack;
    comp.release.value = CONFIG.compRelease;
    comp.connect(this.ctx.destination);
    this.comp = comp;
    this.recordDest = null;
    this.recording = false;
    this.setReverb(CONFIG.reverb);

    this.cache = new Map();
    this.voices = new Map(); // string id → { gain, until } still sounding
    this.drums = null;
  }

  /** Wet echo. `reverbFull` matches the original mix; 0 is dry. */
  setReverb(amount) {
    if (this.ctx.state === "closed") return;
    const value = Math.max(0, Math.min(CONFIG.reverbMax, amount));
    const full = CONFIG.reverbFull || 0.25;
    const t = this.ctx.currentTime;
    this.reverbWet.gain.setValueAtTime(Math.min(1, value / full), t);
    this.reverbFb.gain.setValueAtTime(value, t);
  }

  /** Build every scale note once, so the first pluck does not allocate its buffer on the downbeat. */
  warm() {
    for (const note of scaleNotes()) this.buffer(note.freq);
  }

  /** Resume audio. Outside a user gesture the browser may ignore this. */
  resume() {
    if (this.ctx.state === "closed" || this.ctx.state === "running") return Promise.resolve();
    return this.ctx.resume();
  }

  close() {
    this.closeRecorder();
    if (this.ctx.state === "closed") return Promise.resolve();
    return this.ctx.close();
  }

  /**
   * Send the same mix the speakers hear into a media stream.
   * Connected only while a recording is running, so idle playback is unchanged.
   */
  openRecorder() {
    if (this.ctx.state === "closed") return null;
    if (!this.recordDest) this.recordDest = this.ctx.createMediaStreamDestination();
    if (!this.recording) {
      this.comp.connect(this.recordDest);
      this.recording = true;
    }
    return this.recordDest.stream;
  }

  closeRecorder() {
    if (!this.recording || !this.recordDest) return;
    this.comp.disconnect(this.recordDest);
    this.recording = false;
  }

  /** Pluck buffer cached per timbre and frequency. */
  buffer(freq, timbre = CONFIG.timbre) {
    timbre = timbre === "bass" || timbre === "glass" || timbre === "song" ? timbre : "harp";
    const key = `${timbre}:${Math.round(freq * 10)}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * 2.5);
    const buf = this.ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    if (timbre === "glass") fillGlass(d, freq, sr);
    else if (timbre === "song") fillSong(d, freq, sr);
    else if (timbre === "bass") fillKarplus(d, freq, sr, CONFIG.bassDecay, true);
    else fillKarplus(d, freq, sr, CONFIG.decay, false);
    this.cache.set(key, buf);
    return buf;
  }

  /**
   * velocity 0..1, pan -1..1. `delaySec` is the strum offset; the first string in a swipe uses 0.
   * Skips the note if the context is not running, so it cannot queue and pop later.
   * The gain node is kept on `stringId` so a mute can ramp it down.
   */
  pluck(freq, velocity = 0.8, pan = 0, delaySec = 0, stringId = 0, timbre) {
    if (this.ctx.state !== "running") {
      this.resume();
      return;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer(freq, timbre);
    const g = this.ctx.createGain();
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    const t = this.ctx.currentTime;
    const t0 = t + Math.max(0, delaySec);
    const peak = Math.max(0.0001, 0.25 + 0.75 * velocity);
    g.gain.setValueAtTime(0.0001, t);
    if (t0 > t) g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + CONFIG.pluckAttackSec);
    src.connect(g).connect(panner).connect(this.master);
    src.start(t0);
    this.track(stringId, g, t0 + src.buffer.duration);
  }

  /** Kick, snare, hat, tom, or shaker. Buffers are built on the first hit and then reused. */
  hitDrum(kind, velocity = 0.8, pan = 0, freq = 0) {
    if (this.ctx.state !== "running") {
      this.resume();
      return;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.drumBuffer(kind, freq);
    const g = this.ctx.createGain();
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    const t = this.ctx.currentTime;
    const peak = Math.max(0.0001, CONFIG.drumGain * (0.35 + 0.65 * velocity));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + CONFIG.pluckAttackSec);
    src.connect(g).connect(panner).connect(this.master);
    src.start(t);
    src.onended = () => g.disconnect();
  }

  drumBuffer(kind, freq = 0) {
    if (!this.drums) this.drums = new Map();
    const voice = kind === "drum" ? "tom" : kind;
    const key = voice === "tom" ? `tom:${Math.round(freq)}` : kind;
    if (this.drums.has(key)) return this.drums.get(key);
    const sr = this.ctx.sampleRate;
    const seconds = voice === "kick" ? CONFIG.kickSec
      : voice === "hat" ? CONFIG.hatSec
      : voice === "tom" ? CONFIG.tomSec
      : voice === "shaker" ? CONFIG.shakerSec
      : CONFIG.snareSec;
    const buf = this.ctx.createBuffer(1, Math.max(1, Math.floor(sr * seconds)), sr);
    const data = buf.getChannelData(0);
    if (voice === "kick") fillKick(data, sr);
    else if (voice === "hat") fillHat(data, sr);
    else if (voice === "tom") fillTom(data, sr, freq || 140);
    else if (voice === "shaker") fillShaker(data, sr);
    else fillSnare(data, sr);
    this.drums.set(key, buf);
    return buf;
  }

  /** A quiet octave-down drone. Oscillators are created on the first call and then only retuned. */
  startDrone(freq) {
    if (this.ctx.state !== "running") return false;
    this.ensureDrone();
    this.setDroneFreq(freq);
    const gain = this.drone.gain.gain;
    const t = this.ctx.currentTime;
    gain.cancelScheduledValues(t);
    gain.setValueAtTime(Math.max(gain.value, 0.0001), t);
    gain.exponentialRampToValueAtTime(CONFIG.droneGain, t + 0.08);
    this.drone.on = true;
    return true;
  }

  setDroneFreq(freq) {
    if (!this.drone) return;
    const root = Math.max(30, freq / 2);
    const t = this.ctx.currentTime;
    for (const tone of this.drone.tones) tone.osc.frequency.setTargetAtTime(root * tone.ratio, t, 0.04);
  }

  stopDrone() {
    if (!this.drone?.on) return;
    const gain = this.drone.gain.gain;
    const t = this.ctx.currentTime;
    gain.cancelScheduledValues(t);
    gain.setValueAtTime(Math.max(gain.value, 0.0001), t);
    gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    this.drone.on = false;
  }

  /** 1 is the top of the frame. Only used while a drone hand is held. */
  conduct(amount) {
    const span = CONFIG.droneLevelMax - CONFIG.droneLevelMin;
    const gain = CONFIG.droneLevelMin + span * Math.min(1, Math.max(0, amount));
    this.master.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.05);
  }

  restoreGain() {
    if (this.ctx.state === "closed") return;
    this.master.gain.setTargetAtTime(CONFIG.masterGain, this.ctx.currentTime, 0.08);
  }

  ensureDrone() {
    if (this.drone) return;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.0001;
    const partials = [
      { ratio: 1, amp: 1 },
      { ratio: 1.003, amp: 0.55 },
      { ratio: 1.5, amp: 0.22 },
    ];
    const tones = partials.map((partial) => {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = 110;
      const level = this.ctx.createGain();
      level.gain.value = partial.amp;
      osc.connect(level).connect(gain);
      osc.start();
      return { osc, ratio: partial.ratio };
    });
    gain.connect(this.master);
    this.drone = { gain, tones, on: false };
  }

  /** Ramp every live pluck of this string to silence. */
  damp(stringId) {
    const list = this.voices.get(stringId);
    if (!list || this.ctx.state !== "running") return;
    const t = this.ctx.currentTime;
    for (const v of list) {
      const g = v.gain.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(Math.max(g.value, 0.0001), t);
      g.exponentialRampToValueAtTime(0.0001, t + CONFIG.muteRampSec);
    }
  }

  track(stringId, gain, until) {
    const now = this.ctx.currentTime;
    const list = this.voices.get(stringId) ?? [];
    const live = [];
    for (const v of list) {
      if (v.until > now) live.push(v);
      else v.gain.disconnect();
    }
    live.push({ gain, until });
    this.voices.set(stringId, live);
  }
}

const SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

/** Scientific pitch name. MIDI 60 is C4. Spelling follows the active scale. */
export function midiToName(midi, spelling = CONFIG.spelling) {
  const n = Math.round(midi);
  const pc = ((n % 12) + 12) % 12;
  const names = spelling === "flat" ? FLAT : SHARP;
  return `${names[pc]}${Math.floor(n / 12) - 1}`;
}

/** A short clear tone so a tune stays a tune instead of a wash of harp rings. */
function fillSong(d, freq, sr) {
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    const env = Math.exp(-t * CONFIG.songDecay);
    d[i] = (Math.sin(2 * Math.PI * freq * t) + 0.18 * Math.sin(4 * Math.PI * freq * t)) * env;
  }
}

function fillKarplus(d, freq, sr, decay, lowpass) {
  const n = Math.max(2, Math.round(sr / freq));
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  let prev = 0;
  for (let i = n; i < d.length; i++) {
    const i0 = i - n;
    const avg = lowpass
      ? (d[i0] + d[i0 + 1] + (i0 + 2 < i ? d[i0 + 2] : d[i0])) / 3
      : 0.5 * (d[i0] + d[i0 + 1]);
    const raw = decay * avg;
    if (lowpass) {
      prev += CONFIG.bassPole * (raw - prev);
      d[i] = prev;
    } else {
      d[i] = raw;
    }
  }
}

/** A falling sine plus a short click. The pitch drop is what makes it a kick. */
export function fillKick(d, sr) {
  const floor = CONFIG.kickFloorHz;
  const drop = CONFIG.kickHz - floor;
  const sweep = CONFIG.kickSweep;
  let phase = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    const freq = floor + drop * Math.exp(-t * sweep);
    phase += (2 * Math.PI * freq) / sr;
    const click = (Math.random() * 2 - 1) * Math.exp(-t * 90) * CONFIG.kickClick;
    d[i] = (Math.sin(phase) + click) * Math.exp(-t * CONFIG.kickDecay);
  }
}

/** Inharmonic metal plus a little hiss. The same recipe as an 808 hat, written for this synth. */
export function fillHat(d, sr) {
  const freqs = [205.3, 304.4, 369.6, 522.7, 540, 800];
  let low = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    let metal = 0;
    for (const freq of freqs) metal += Math.sin(2 * Math.PI * freq * t) > 0 ? 1 : -1;
    const white = Math.random() * 2 - 1;
    const mixed = metal / freqs.length * 0.7 + white * 0.3;
    low += 0.18 * (mixed - low);
    d[i] = (mixed - low) * Math.exp(-t * 26) * 0.65;
  }
}

/** A kick with a higher floor. `freq` is the pitch the skin settles on. */
export function fillTom(d, sr, freq) {
  const floor = Math.max(50, freq);
  const drop = floor * 1.35;
  let phase = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    phase += (2 * Math.PI * (floor + drop * Math.exp(-t * 16))) / sr;
    d[i] = Math.sin(phase) * Math.exp(-t * 7);
  }
}

/** A few grains of bright noise, the way a shaker speaks. */
export function fillShaker(d, sr) {
  let low = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    const white = Math.random() * 2 - 1;
    low += 0.12 * (white - low);
    const grain = Math.exp(-((t * 28) % 1) * 5);
    d[i] = (white - low) * grain * Math.exp(-t * 10) * 0.7;
  }
}

/** Noise burst plus a short tone. The noise is the snare; the tone is the shell. */
export function fillSnare(d, sr) {
  let low = 0;
  const pole = CONFIG.snarePole;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    const white = Math.random() * 2 - 1;
    low += pole * (white - low);
    const noise = (white - low) * Math.exp(-t * CONFIG.snareDecay);
    const body = Math.sin(2 * Math.PI * CONFIG.snareHz * t) * Math.exp(-t * CONFIG.snareBodyDecay);
    d[i] = noise * CONFIG.snareNoise + body * CONFIG.snareBody;
  }
}

function fillGlass(d, freq, sr) {
  const partials = CONFIG.glassPartials;
  const amps = CONFIG.glassAmps;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    let sum = 0;
    for (let p = 0; p < partials.length; p++) {
      sum += amps[p] * Math.sin(2 * Math.PI * freq * partials[p] * t);
    }
    d[i] = sum * Math.exp(-t * CONFIG.glassDecay) * CONFIG.glassMix;
  }
}

/**
 * Quantize a string length to the configured scale. Longer = lower.
 * @returns {{ freq: number, midi: number, name: string }}
 */
export function lengthToNote(length, maxLength) {
  const { scale, octaves } = CONFIG;
  const steps = scale.length * octaves;
  const t = 1 - Math.min(1, Math.max(0, length / maxLength)); // 0 = long, 1 = short
  const idx = Math.min(steps - 1, Math.floor(t * steps));
  const midi = CONFIG.baseMidi + CONFIG.root + 12 * Math.floor(idx / scale.length) + scale[idx % scale.length];
  return { midi, name: midiToName(midi), freq: 440 * Math.pow(2, (midi - 69) / 12) };
}

/** Map a string length (px) to a frequency in the configured scale. Longer = lower. */
export function lengthToFreq(length, maxLength) {
  return lengthToNote(length, maxLength).freq;
}

/**
 * The next notes up the scale from a frequency already in that scale.
 * Stops at the top of the instrument instead of wrapping.
 */
export function nextScaleFreqs(freq, count) {
  const { scale, octaves } = CONFIG;
  const steps = scale.length * octaves;
  const notes = [];
  for (let idx = 0; idx < steps; idx++) {
    const midi = CONFIG.baseMidi + CONFIG.root + 12 * Math.floor(idx / scale.length) + scale[idx % scale.length];
    notes.push(440 * Math.pow(2, (midi - 69) / 12));
  }
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < notes.length; i++) {
    const gap = Math.abs(Math.log(notes[i] / freq));
    if (gap < bestD) {
      bestD = gap;
      best = i;
    }
  }
  const out = [];
  for (let n = 1; n <= count && best + n < notes.length; n++) out.push(notes[best + n]);
  return out;
}

/** Every note the current scale can play, lowest first. */
export function scaleNotes() {
  const { scale, octaves } = CONFIG;
  const notes = [];
  const steps = scale.length * octaves;
  for (let idx = 0; idx < steps; idx++) {
    const midi = CONFIG.baseMidi + 12 * Math.floor(idx / scale.length) + scale[idx % scale.length];
    notes.push({ midi, name: midiToName(midi), freq: 440 * Math.pow(2, (midi - 69) / 12) });
  }
  return notes;
}
