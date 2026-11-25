import { CONFIG } from "./config.js";
import { dist, distToSegment, snapTo } from "./geometry.js";
import { startCamera, createHandTracker, toPixels } from "./tracking.js";
import { LM, assignHands, beginPinch, gestureLabel, strikeVoice } from "./gestures.js";
import { StringField, velocityCurve } from "./strings.js";
import { DrumKit, drumFreq } from "./drums.js";
import { Synth, nextScaleFreqs } from "./audio.js";
import { activeSong, songPhrase } from "./songs.js";
import { stampLoop, dueEvents, upcoming } from "./loop.js";
import { Particles } from "./particles.js";
import { drawVideo, drawDisco, drawHand, drawGestureState, drawStrings, drawPads, drawCursor, drawWipe } from "./render.js";
import { applySettings, bindPanel, currentSettings, readSaved, writeSaved } from "./settings.js";
import { Recorder, chooseMime, downloadBlob, recordFilename } from "./record.js";

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const hud = document.getElementById("hud");
const toast = document.getElementById("toast");
const nowPlaying = document.getElementById("nowPlaying");
const nowMeta = document.getElementById("nowMeta");
const nowLine = document.getElementById("nowLine");
const nowSwar = document.getElementById("nowSwar");
const startScreen = document.getElementById("start");
const startBtn = document.getElementById("startBtn");
const recordBtn = document.getElementById("recordBtn");
const guide = document.getElementById("guide");
const guideHide = document.getElementById("guideHide");
const panel = document.getElementById("panel");
const recordDot = document.getElementById("recordDot");
const recordLabel = document.getElementById("recordLabel");

const saved = readSaved();
if (saved) applySettings(saved.settings);
if (saved?.hadStrings) writeSaved(currentSettings());

const field = new StringField();
const kit = new DrumKit();
const takes = [];
const replies = [];
const songNotes = [];
let songUntil = 0;
let shownLine = 0;
let bar = null;
const particles = new Particles();
const hands = new Map(); // handedness label -> the HandState that still sits at that wrist
let tracker, synth;
let debug = true;
let canvasReady = false;
let lastVideoTime = -1;
let lastFrame = performance.now();
let fps = 0;
let toastTimer = 0;
let lastHitMs = 0;
let stringMs = 0;
let activeLabels = "";
let wipeFrom = 0;
const recorder = new Recorder();
let recordOn = false;
let recordSec = -1;

recorder.onstop = (blob) => {
  synth?.closeRecorder();
  paintRecord(performance.now());
  if (!blob.size) {
    showToast("Recording was empty");
    return;
  }
  const name = recordFilename();
  downloadBlob(blob, name);
  showToast(`Saved ${name}`);
};

toast.style.transition = `opacity ${CONFIG.toastFadeMs}ms ease`;

function persist() {
  writeSaved(currentSettings());
}


bindPanel((next) => {
  const prev = currentSettings();
  applySettings(next);
  const nowSettings = currentSettings();
  const musical = prev.scaleId !== nowSettings.scaleId
    || prev.root !== nowSettings.root
    || prev.octaves !== nowSettings.octaves
    || prev.timbre !== nowSettings.timbre
    || prev.songId !== nowSettings.songId;
  if (musical) {
    const span = Math.hypot(canvas.width, canvas.height) * 0.7;
    if (span) field.retune(span);
    if (synth) synth.warm();
  }
  if (synth && prev.reverb !== nowSettings.reverb) synth.setReverb(nowSettings.reverb);
  if (prev.songId !== nowSettings.songId) {
    songNotes.length = 0;
    songUntil = 0;
    hideNowPlaying();
    if (activeSong().steps) showToast(`${activeSong().name} — pluck once`);
  }
  persist();
});

/** Size the canvas element to the video aspect. Bitmap pixels stay the video size, so landmarks match the drawing. */
function fitCanvas() {
  if (!canvasReady) return;
  const scale = Math.min(window.innerWidth / canvas.width, window.innerHeight / canvas.height);
  canvas.style.width = `${Math.floor(canvas.width * scale)}px`;
  canvas.style.height = `${Math.floor(canvas.height * scale)}px`;
}

/** Sit the gesture strip on the picture, clear of Record and Tune. */
function placeGuide() {
  if (guide.hidden) return;
  const margin = 8;
  const picture = canvas.style.width ? canvas.getBoundingClientRect() : null;
  const onPicture = picture && picture.width > 40 && picture.height > 40;
  const top0 = onPicture ? picture.top : 0;
  const left0 = onPicture ? picture.left : 0;
  const right0 = onPicture ? picture.right : window.innerWidth;
  const record = recordBtn.hidden ? null : recordBtn.getBoundingClientRect();
  const tune = panel.getBoundingClientRect();
  let top = top0 + margin;
  let left = left0 + margin;
  let right = right0 - margin;
  if (record && record.bottom > top && record.right > left0) left = Math.max(left, record.right + margin);
  if (tune.bottom > top && tune.left < right0) right = Math.min(right, tune.left - margin);
  if (!guide.classList.contains("is-collapsed") && right - left < 280) {
    top = Math.max(record ? record.bottom : 0, tune.bottom) + margin;
    left = left0 + margin;
    right = right0 - margin;
  }
  guide.style.top = `${Math.round(top)}px`;
  guide.style.left = `${Math.round(left)}px`;
  guide.style.width = guide.classList.contains("is-collapsed") ? "auto" : `${Math.max(180, Math.round(right - left))}px`;
}

window.addEventListener("resize", () => {
  fitCanvas();
  placeGuide();
});

guideHide.addEventListener("click", () => {
  const collapsed = guide.classList.toggle("is-collapsed");
  guideHide.textContent = collapsed ? "Gestures" : "Hide";
  guideHide.setAttribute("aria-expanded", String(!collapsed));
  placeGuide();
});
document.getElementById("panelToggle").addEventListener("click", () => placeGuide());

/** Big lyric and swar while a sung tune is sounding. Other songs have no words, so this stays hidden. */
function showNowPlaying(note) {
  nowPlaying.hidden = false;
  nowMeta.textContent = `Playing · ${note.line} of ${note.lines}`;
  if (shownLine !== note.line) {
    shownLine = note.line;
    nowLine.replaceChildren();
    for (const [index, word] of (note.syllables || []).entries()) {
      const span = document.createElement("span");
      span.textContent = word;
      span.dataset.i = String(index);
      nowLine.append(span);
    }
  }
  for (const span of nowLine.children) {
    span.classList.toggle("on", Number(span.dataset.i) === note.mark);
  }
  nowSwar.textContent = note.swar;
  nowSwar.classList.remove("pop");
  void nowSwar.offsetWidth;
  nowSwar.classList.add("pop");
}

function hideNowPlaying() {
  nowPlaying.hidden = true;
  shownLine = 0;
}

/** @param {string} text */
function showToast(text) {
  toast.textContent = text;
  toast.classList.remove("show");
  void toast.offsetWidth;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), CONFIG.toastMs);
}

function stopCamera() {
  const stream = video.srcObject;
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
  video.srcObject = null;
}

startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  startBtn.textContent = "Loading…";
  try {
    if (synth) await synth.close();
    synth = new Synth();
    await synth.resume();
    synth.warm();
    await startCamera(video);
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvasReady = true;
    fitCanvas();
    tracker = await createHandTracker();
    await synth.resume();
    if (synth.ctx.state !== "running") console.warn("AudioContext is", synth.ctx.state);
    startScreen.remove();
    recordBtn.hidden = false;
    guide.hidden = false;
    placeGuide();
    showToast("Camera ready");
    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    stopCamera();
    if (synth) {
      await synth.close().catch(() => {});
      synth = null;
    }
    canvasReady = false;
    startBtn.disabled = false;
    const cameraErr = err && (err.name === "NotAllowedError" || err.name === "NotFoundError" || err.name === "NotReadableError");
    startBtn.textContent = cameraErr ? "Camera blocked — retry" : "Setup failed — retry";
  }
});

window.addEventListener("pointerdown", () => synth?.resume());

window.addEventListener("keydown", (e) => {
  synth?.resume();
  if (e.target.closest?.("#panel")) return;
  const k = e.key.toLowerCase();
  if (k === "d") debug = !debug;
  if (k === "r" && !e.repeat) toggleRecord();
  if (wipeFrom) return;
  if (k === "z" && field.strings.length) {
    field.undo();
    const span = Math.hypot(canvas.width, canvas.height) * 0.7;
    if (span) field.retune(span);
    persist();
    showToast("Undo");
  }
  if (k === "c") startWipe();
});

recordBtn.addEventListener("click", () => {
  synth?.resume();
  toggleRecord();
});

function toggleRecord() {
  if (recorder.active) {
    recorder.stop();
    return;
  }
  if (!canvasReady || !synth || synth.ctx.state !== "running") {
    showToast("Start the camera first");
    return;
  }
  const mime = chooseMime((type) => MediaRecorder.isTypeSupported(type));
  if (!mime) {
    showToast("This browser can't record WebM");
    return;
  }
  const audio = synth.openRecorder();
  if (!audio) {
    showToast("Recording failed");
    return;
  }
  try {
    recorder.start(canvas, audio, mime);
    paintRecord(performance.now());
    showToast("Recording");
  } catch (err) {
    console.error(err);
    synth.closeRecorder();
    recorder.cancel();
    paintRecord(performance.now());
    showToast("Recording failed");
  }
}

/** The timer text changes once a second. The dot itself is a CSS pulse. */
function paintRecord(now) {
  const on = recorder.active;
  if (on !== recordOn) {
    recordOn = on;
    recordBtn.setAttribute("aria-pressed", on ? "true" : "false");
    recordDot.hidden = !on;
    if (!on) {
      recordLabel.textContent = "Record";
      recordSec = -1;
      placeGuide();
    }
  }
  if (!on) return;
  const sec = Math.floor((now - recorder.startedAt) / 1000);
  if (sec === recordSec) return;
  recordSec = sec;
  recordLabel.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  placeGuide();
}

function startWipe() {
  if (wipeFrom || (!field.strings.length && !kit.pads.length)) return;
  wipeFrom = performance.now();
}

function playPad(pad, velocity) {
  const pan = (pad.x / (canvas.width || 1)) * 2 - 1;
  synth.hitDrum(pad.kind, velocity, pan, pad.freq);
  particles.burst({ x: pad.x, y: pad.y }, pad.hue, velocity, { x: 1, y: 0 });
  remember({
    t: performance.now(),
    sound: `drum:${pad.kind}:${pad.born}`,
    kind: "drum",
    drum: pad.kind,
    velocity,
    pan,
    freq: pad.freq,
    pad,
  });
}

function remember(event) {
  takes.push(event);
  const cutoff = event.t - CONFIG.loopCaptureMs;
  let i = 0;
  while (i < takes.length) {
    if (takes[i].t < cutoff) takes.splice(i, 1);
    else i += 1;
  }
}

function sympathize(origin, freq, velocity, pan, timbre) {
  const gain = velocity * CONFIG.sympathyGain;
  for (const neighbor of field.neighbors(origin, CONFIG.sympathyPx, CONFIG.sympathyMax)) {
    synth.pluck(freq, gain, pan, 0, neighbor.id, timbre);
    if (neighbor.energy(performance.now()) * neighbor.amp < CONFIG.sympathyAmp) {
      neighbor.pluckedAt = performance.now();
      neighbor.amp = CONFIG.sympathyAmp;
      neighbor.muted = false;
    }
  }
}

function playAnswer(hit, timbre) {
  const more = nextScaleFreqs(hit.string.freq, CONFIG.answerNotes);
  const width = canvas.width || 1;
  const xNorm = Math.min(1, Math.max(0, hit.point.x / width));
  const step = CONFIG.answerStepLeftMs + (CONFIG.answerStepRightMs - CONFIG.answerStepLeftMs) * xNorm;
  const velocity = CONFIG.answerVelLeft + (CONFIG.answerVelRight - CONFIG.answerVelLeft) * xNorm;
  const pan = (hit.point.x / width) * 2 - 1;
  const now = performance.now();
  for (let i = 0; i < more.length; i++) {
    replies.push({
      at: now + step * (i + 1),
      freq: more[i],
      velocity,
      pan,
      stringId: hit.string.id,
      timbre,
    });
  }
}

function replay(event) {
  const now = performance.now();
  if (event.kind === "pluck") {
    synth.pluck(event.freq, event.velocity, event.pan, 0, event.stringId, event.timbre);
    const string = field.strings.find((s) => s.id === event.stringId);
    if (!string) return;
    string.pluckedAt = now;
    string.amp = event.velocity;
    string.muted = false;
    string.pluckT = 0.5;
    if (!event.chord) sympathize(string, event.freq, event.velocity, event.pan, event.timbre);
    return;
  }
  synth.hitDrum(event.drum, event.velocity, event.pan, event.freq);
  if (event.pad && kit.pads.includes(event.pad)) event.pad.hitAt = now;
}

function advanceLoop(now) {
  if (!bar) return;
  const pos = (now - bar.anchor) % bar.barMs;
  for (const event of dueEvents(bar, pos, bar.pos)) replay(event);
  for (const event of upcoming(bar, pos, CONFIG.loopSoonMs)) {
    if (event.stringId) {
      const string = field.strings.find((s) => s.id === event.stringId);
      if (string) string.soon = now;
    }
    if (event.pad && kit.pads.includes(event.pad)) event.pad.soon = now;
  }
  bar.pos = pos;
}

/** One pluck starts the selected tune. Further plucks wait until it finishes. */
function beginSong(now) {
  if (!activeSong().steps) return false;
  if (now < songUntil) return true;
  const phrase = songPhrase(now);
  if (!phrase) return false;
  songNotes.push(...phrase.notes);
  songUntil = phrase.until;
  return true;
}

function flushSong(now) {
  const strings = field.strings.filter((s) => !s.draft);
  let i = 0;
  while (i < songNotes.length) {
    const note = songNotes[i];
    if (note.at > now) {
      i += 1;
      continue;
    }
    const string = strings.length ? strings[note.index % strings.length] : null;
    synth.pluck(note.freq, 0.9, 0, 0, string ? string.id : 0, "song");
    if (string) {
      string.pluckedAt = now;
      string.amp = 0.9;
      string.muted = false;
      string.pluckT = 0.5;
      string.name = note.swar || note.name;
      string.hue = (note.freq * 0.7) % 360;
      string.sung = note.swar || note.name;
    }
    if (note.swar) showNowPlaying(note);
    songNotes.splice(i, 1);
  }
  if (songUntil && now >= songUntil && !songNotes.length) {
    songUntil = 0;
    hideNowPlaying();
    const span = Math.hypot(canvas.width, canvas.height) * 0.7;
    if (span) field.retune(span);
  }
}

function flushReplies(now) {
  let i = 0;
  while (i < replies.length) {
    const reply = replies[i];
    if (reply.at > now) {
      i += 1;
      continue;
    }
    synth.pluck(reply.freq, reply.velocity, reply.pan, 0, reply.stringId, reply.timbre);
    const string = field.strings.find((s) => s.id === reply.stringId);
    if (string) {
      string.pluckedAt = now;
      string.amp = Math.max(string.amp * string.energy(now), reply.velocity);
      string.muted = false;
    }
    replies.splice(i, 1);
  }
}

/** Two empty-space pinches become one string stretched between the hands. */
function linkSpans(pending, maxLen) {
  const drawing = pending.filter((item) => item.state.gesture === "arm" && item.state.pinching);
  if (drawing.length < 2) return;
  const [first, second] = drawing;
  endDrone(first.state);
  endDrone(second.state);
  const span = field.place(first.state.pinchPoint, second.state.pinchPoint, maxLen);
  first.state.gesture = "span";
  first.state.span = span;
  first.state.spanEnd = "a";
  second.state.gesture = "span";
  second.state.span = span;
  second.state.spanEnd = "b";
}

function releaseSpan(state, maxLen) {
  const span = state.span;
  if (span && field.strings.includes(span) && CONFIG.snap) {
    const a = snapTo(span.a, CONFIG.grid);
    span.a.x = a.x;
    span.a.y = a.y;
    field.setEnd(span, "b", snapTo(span.b, CONFIG.grid), maxLen);
  }
  const kept = span && field.strings.includes(span) ? field.finishSpan(span) : null;
  for (const hand of hands.values()) {
    if (hand.span !== span) continue;
    hand.span = null;
    hand.spanEnd = null;
    if (hand !== state && hand.pinching) hand.gesture = "suppress";
  }
  state.gesture = null;
  state.span = null;
  return kept;
}

function endDrone(state) {
  if (!state?.drone) return;
  state.drone = null;
  synth?.stopDrone();
  synth?.restoreGain();
}

function releaseGrab(state, maxLen) {
  const grab = state.grab;
  if (!grab || !field.strings.includes(grab.string)) return;
  if (CONFIG.snap && (state.gesture === "nudge" || state.gesture === "move")) {
    if (state.gesture === "move") {
      const a = snapTo(grab.string.a, CONFIG.grid);
      grab.string.a.x = a.x;
      grab.string.a.y = a.y;
    }
    const end = state.gesture === "nudge" ? grab.end : "b";
    field.setEnd(grab.string, end, snapTo(grab.string[end], CONFIG.grid), maxLen);
  }
  if (state.gesture === "nudge") showToast(`Retuned (${grab.string.name})`);
  if (state.gesture === "nudge" || state.gesture === "move") persist();
}

function loop(now) {
  const dt = now - lastFrame;
  lastFrame = now;
  fps = fps * 0.9 + (1000 / Math.max(1, dt)) * 0.1;
  const W = canvas.width, H = canvas.height;
  const maxLen = Math.hypot(W, H) * 0.7;

  let result = null;
  let detectedAt = 0;
  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    result = tracker.detectForVideo(video, now);
    detectedAt = performance.now();
  }

  drawVideo(ctx, video, W, H);
  drawDisco(ctx, field.strings, kit.pads, now, W, H);
  const cursors = [];

  if (result) {
    const detections = [];
    result.landmarks.forEach((lm, i) => {
      const px = toPixels(lm, W, H);
      detections.push({
        label: result.handedness?.[i]?.[0]?.categoryName ?? `h${i}`,
        score: result.handedness?.[i]?.[0]?.score ?? 0,
        px,
        wrist: px[LM.WRIST],
      });
    });
    const { pairs, seen } = assignHands(detections, hands);
    const pending = [];
    for (const { detection, state } of pairs) {
      if (state.wasMissing) {
        state.rebase(true);
        state.wasMissing = false;
      }
      state.label = detection.label;
      pending.push({ state, px: detection.px, ev: state.update(detection.px, now) });
    }
    activeLabels = pending.map((p) => `${p.state.label} ${gestureLabel(p.state)}`).join(" · ");

    const starters = pending.filter((p) => p.ev.type === "pinchStart");
    starters.sort((a, b) => a.ev.ratio - b.ev.ratio);
    for (const item of starters) {
      const cap = field.capAt(item.ev.at, CONFIG.capGrabPx);
      const near = cap ? [] : field.near(item.ev.at, CONFIG.muteRadius);
      near.sort((a, b) => distToSegment(item.ev.at, a.a, a.b) - distToSegment(item.ev.at, b.a, b.b));
      beginPinch(item.state, { drawTaken: false, near: near.slice(0, 1), cap });
    }
    linkSpans(pending, maxLen);

    let played = false;
    for (const { state, px, ev } of pending) {
      if (state.palmFired) startWipe();
      if (state.grab && !field.strings.includes(state.grab.string)) {
        state.grab = null;
        if (state.gesture === "hold" || state.gesture === "mute" || state.gesture === "move" || state.gesture === "nudge") {
          state.gesture = "suppress";
        }
      }
      if (ev.type === "pinchMove" && state.gesture === "hold") {
        if (dist(state.pinchStart, state.pinchPoint) >= CONFIG.grabSlopPx) {
          state.gesture = "move";
          state.grab.last = { x: state.pinchStart.x, y: state.pinchStart.y };
        } else if (now - state.pinchAt >= CONFIG.muteHoldMs) {
          state.gesture = "mute";
          if (state.grab.string.damp(now)) synth.damp(state.grab.string.id);
        }
      }
      if (ev.type === "pinchMove" && state.gesture === "move") {
        const last = state.grab.last;
        field.moveBy(state.grab.string, state.pinchPoint.x - last.x, state.pinchPoint.y - last.y);
        state.grab.last = { x: state.pinchPoint.x, y: state.pinchPoint.y };
        field.retune(maxLen);
      }
      if (ev.type === "pinchMove" && state.gesture === "nudge") {
        field.setEnd(state.grab.string, state.grab.end, state.pinchPoint, maxLen);
      }
      if (ev.type === "pinchMove" && state.gesture === "span" && state.span && field.strings.includes(state.span)) {
        field.setEnd(state.span, state.spanEnd, state.pinchPoint, maxLen);
      }
      if (ev.type === "pinchMove" && state.gesture === "arm") {
        if (state.drone && !field.strings.includes(state.drone)) endDrone(state);
        if (state.drone) {
          synth.conduct(1 - Math.min(1, Math.max(0, state.pinchPoint.y / H)));
        } else if (now - state.pinchAt >= CONFIG.droneHoldMs) {
          const nearest = field.nearest(state.pinchPoint, CONFIG.droneRadius);
          if (nearest && synth.startDrone(nearest.freq)) {
            state.drone = nearest;
            synth.conduct(1 - Math.min(1, Math.max(0, state.pinchPoint.y / H)));
          }
        }
      }
      if (ev.type === "pinchMove" && state.gesture === "mute") {
        for (const s of field.near(ev.to, CONFIG.muteRadius)) if (s.damp(now)) synth.damp(s.id);
      }
      if (ev.type === "pinchEnd") {
        endDrone(state);
        if (state.gesture === "span" && !wipeFrom) {
          const kept = releaseSpan(state, maxLen);
          if (kept) {
            field.retune(maxLen);
            kept.pluckedAt = now;
            persist();
            showToast(`String added (${kept.name})`);
          }
        } else if (state.gesture === "nudge" || state.gesture === "move") {
          releaseGrab(state, maxLen);
        }
        state.gesture = null;
        state.grab = null;
      }
      if (state.loopDrop && bar) {
        bar = null;
        showToast("Loop cleared");
      }
      if (state.loopStamp && !wipeFrom) {
        const made = stampLoop(takes, now);
        if (!made) showToast("Play a bar first");
        else {
          bar = { barMs: made.barMs, beat: made.beat, events: made.events, anchor: now, pos: 0 };
          showToast("Bar looping");
        }
      }
      if (state.answer) {
        const resting = state.answer.string;
        const stillThere = field.strings.includes(resting) && state.tip
          && !state.pinching
          && distToSegment(state.tip, resting.a, resting.b) <= CONFIG.answerRadius;
        if (!stillThere) state.answer = null;
        else if (now - state.answer.since >= CONFIG.answerHoldMs) {
          playAnswer(state.answer.hit, state.answer.timbre);
          state.answer = null;
        }
      }
      if (state.shake && state.wrist && !wipeFrom) {
        synth.hitDrum("shaker", 0.65, (state.wrist.x / W) * 2 - 1);
        particles.burst(state.wrist, 150, 0.35, { x: 1, y: 0 });
      }
      if (state.drum && state.wrist && !wipeFrom) {
        const pad = kit.contains([state.wrist, state.tip], now);
        const velocity = velocityCurve(state.wristMotion()?.speed || 0);
        if (pad) playPad(pad, velocity);
        else {
          const pan = (state.wrist.x / W) * 2 - 1;
          synth.hitDrum(state.drum, velocity, pan);
          particles.burst(state.wrist, state.drum === "kick" ? 28 : 210, velocity, state.drumDir);
          remember({
            t: now,
            sound: `drum:${state.drum}:air`,
            kind: "drum",
            drum: state.drum,
            velocity,
            pan,
            freq: 0,
            pad: null,
          });
        }
      }
      if (ev.type === "move" && ev.from && ev.to && !state.circle && !wipeFrom) {
        const pad = kit.enter(ev.from, ev.to, now);
        if (pad) playPad(pad, velocityCurve(state.tipSpeed()));
      }
      const voice = strikeVoice(state);
      const travel = ev.from && ev.to ? dist(ev.from, ev.to) : 0;
      const deliberate = travel >= CONFIG.songPluckMinPx && state.tipSpeed() >= CONFIG.songPluckPx;
      if (ev.type === "move" && voice && !wipeFrom && (!activeSong().steps || deliberate)) {
        const hits = field.hitPaths(
          voice === "chord"
            ? state.blade.filter((slot) => slot.ready).map((slot) => ({ from: slot.prev, to: slot.tip }))
            : [{ from: ev.from, to: ev.to }],
          now,
          state.tipSpeed(),
        );
        hits.sort((a, b) => dist(ev.from, a.point) - dist(ev.from, b.point));
        if (hits.length) {
          state.circle = null;
          state.trace.length = 0;
        }
        if (hits.length && !played) {
          lastHitMs = performance.now() - detectedAt;
          played = true;
        }
        const playingSong = activeSong().steps && deliberate && hits.length && beginSong(now);
        const stagger = voice === "chord" ? CONFIG.chordStaggerMs : CONFIG.strumStaggerMs;
        const timbre = voice === "glass" ? "glass" : voice === "chord" ? "harp" : undefined;
        if (!playingSong) hits.forEach((hit, i) => {
          if (voice === "chord") {
            hit.velocity = Math.max(hit.velocity, CONFIG.chordFloor);
            hit.string.amp = hit.velocity;
          }
          const delayMs = hit.songDelay ?? i * stagger;
          hit.string.pluckedAt = now + delayMs;
          const pan = (hit.point.x / W) * 2 - 1;
          synth.pluck(hit.string.freq, hit.velocity, pan, delayMs / 1000, hit.string.id, timbre);
          remember({
            t: now + delayMs,
            sound: `pluck:${hit.string.id}`,
            kind: "pluck",
            freq: hit.string.freq,
            velocity: hit.velocity,
            pan,
            stringId: hit.string.id,
            timbre,
            chord: voice === "chord",
          });
          if (voice !== "chord") sympathize(hit.string, hit.string.freq, hit.velocity, pan, timbre);
          if (voice !== "chord" && hits.length === 1) {
            state.answer = { string: hit.string, since: now, hit, timbre };
          }
          const dx = hit.string.b.x - hit.string.a.x;
          const dy = hit.string.b.y - hit.string.a.y;
          const span = Math.hypot(dx, dy) || 1;
          particles.schedule(now + delayMs, hit.point, hit.string.hue, hit.velocity, { x: dx / span, y: dy / span });
        });
      }
      if (state.circle && !wipeFrom) {
        kit.add(state.circle, drumFreq(state.circle.r), now);
        showToast("Drum placed");
      }
      if (debug) {
        drawHand(ctx, px);
        drawGestureState(ctx, state, now);
      }
      cursors.push({ p: state.pinching ? state.pinchPoint : state.tip, pinching: state.pinching });
    }

    for (const [key, state] of [...hands]) {
      if (seen.has(state)) continue;
      state.wasMissing = true;
      if (now - state.lastSeen > CONFIG.handLostMs) {
        endDrone(state);
        hands.delete(key);
      }
    }
  }

  advanceLoop(now);
  flushSong(now);
  flushReplies(now);
  const drawAt = performance.now();
  const wipeX = wipeFrom ? ((now - wipeFrom) / CONFIG.wipeMs) * (W + CONFIG.wipeBand) : null;
  drawStrings(ctx, field.strings, now, W, H, wipeX);
  const traces = [];
  for (const state of hands.values()) if (state.trace.length > 1) traces.push(state.trace);
  drawPads(ctx, kit.pads, traces, now);
  if (wipeFrom && now - wipeFrom >= CONFIG.wipeMs) {
    field.clear();
    kit.clear();
    bar = null;
    replies.length = 0;
    songNotes.length = 0;
    songUntil = 0;
    hideNowPlaying();
    takes.length = 0;
    wipeFrom = 0;
    persist();
    showToast("Cleared");
  } else if (wipeX != null) {
    drawWipe(ctx, W, H, wipeX);
  }
  stringMs = stringMs * 0.9 + (performance.now() - drawAt) * 0.1;
  particles.update(now);
  particles.draw(ctx);
  for (const c of cursors) if (c.p) drawCursor(ctx, c.p, c.pinching);

  const deviceMs = synth?.ctx ? (synth.ctx.outputLatency ?? synth.ctx.baseLatency ?? 0) * 1000 : 0;
  paintRecord(now);
  hud.textContent = debug
    ? `${fps.toFixed(0)} fps · draw ${stringMs.toFixed(1)} ms · ${field.strings.length} strings · hit ${lastHitMs.toFixed(1)} ms · out ${deviceMs.toFixed(0)} ms · ${activeLabels || "none"}`
    : "";

  requestAnimationFrame(loop);
}
