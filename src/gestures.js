import { CONFIG } from "./config.js";
import { circleFromPath } from "./drums.js";
import { dist, lerpPt } from "./geometry.js";

// Landmark indices: https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker
export const LM = {
  WRIST: 0,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_TIP: 12,
  RING_PIP: 14,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_TIP: 20,
};

/** Tip and the joint the spec calls PIP. The thumb uses its IP joint. */
const FINGERS = [
  { tip: LM.THUMB_TIP, pip: LM.THUMB_IP },
  { tip: LM.INDEX_TIP, pip: LM.INDEX_PIP },
  { tip: LM.MIDDLE_TIP, pip: LM.MIDDLE_PIP },
  { tip: LM.RING_TIP, pip: LM.RING_PIP },
  { tip: LM.PINKY_TIP, pip: LM.PINKY_PIP },
];

/**
 * Per-hand state machine. Keyed by handedness label ("Left"/"Right") so state
 * survives hands swapping index order between frames.
 */
export class HandState {
  constructor() {
    this.pinching = false;
    this.pinchStart = null; // {x,y} where the pinch began
    this.tip = null; // smoothed index tip
    this.prevTip = null;
    this.pinchPoint = null; // midpoint of thumb+index while pinching
    this.lastSeen = 0;
    this.wasMissing = false;
    this.wrist = null;
    this.label = "";
    this.gesture = null; // "arm" | "hold" | "mute" | "move" | "nudge" | "span" | "suppress"
    this.samples = []; // recent raw index tips, for swipe speed
    this.extended = [false, false, false, false, false];
    this.indexOut = false;
    this.palm = false;
    this.openSince = null;
    this.palmLatched = false;
    this.palmFired = false;
    this.pinchAt = 0;
    this.grab = null; // { string, end: "a" | "b" | null, last }
    this.span = null;
    this.spanEnd = null;
    this.drone = null; // string this pinch is droning
    this.wristSamples = [];
    this.drum = null; // "kick" | "snare" on the frame a fist strike lands
    this.drumAt = 0;
    this.drumArmed = false;
    this.drumDir = { x: 0, y: 1 };
    this.shake = false;
    this.shakeFlips = 0;
    this.shakeSign = 0;
    this.shakeFrom = 0;
    this.loopSince = null;
    this.loopLatched = false;
    this.loopAnchorY = null;
    this.loopDropLatched = false;
    this.loopStamp = false;
    this.loopDrop = false;
    this.trace = []; // one-finger samples while a circle is being drawn
    this.circle = null; // set on the frame a loop closes
    this.blade = [0, 1, 2].map(() => ({ prev: { x: 0, y: 0 }, tip: { x: 0, y: 0 }, ready: false }));
    // Swipe segments still to discard. A new hand's first motion is a tracking lock, not a pluck.
    this.blockSwipe = CONFIG.appearSettleFrames;
  }

  /** Discard the next swipe segment so a release flick or a tracking gap cannot pluck. */
  rebase() {
    this.blockSwipe = Math.max(this.blockSwipe, CONFIG.gapSettleFrames);
    this.prevTip = null;
    this.samples.length = 0;
    this.openSince = null;
    this.palmLatched = false;
    this.palmFired = false;
    this.wristSamples.length = 0;
    this.drum = null;
    this.drumArmed = false;
    this.shake = false;
    this.shakeFlips = 0;
    this.shakeSign = 0;
    this.loopSince = null;
    this.loopLatched = false;
    this.loopAnchorY = null;
    this.loopDropLatched = false;
    this.trace.length = 0;
    this.circle = null;
    for (const slot of this.blade) slot.ready = false;
  }

  /** Speed of the index tip in px/ms over the last few frames. */
  tipSpeed() {
    const s = this.samples;
    if (s.length < 2) return 0;
    const dt = s[s.length - 1].t - s[0].t;
    if (dt < 1) return 0;
    return dist(s[0], s[s.length - 1]) / dt;
  }

  /**
   * Update with pixel landmarks. Returns an event:
   *  { type: "pinchStart" | "pinchMove" | "pinchEnd" | "move", ... }
   */
  update(px, now) {
    const s = CONFIG.smoothing;
    const rawTip = px[LM.INDEX_TIP];
    const rawBlade = [px[LM.INDEX_TIP], px[LM.MIDDLE_TIP], px[LM.PINKY_TIP]];
    this.lastSeen = now;
    this.wrist = { x: px[LM.WRIST].x, y: px[LM.WRIST].y };
    this.samples.push({ x: rawTip.x, y: rawTip.y, t: now });
    if (this.samples.length > CONFIG.velocityFrames) this.samples.shift();

    // Consume a blocked segment before pinch tests. Pinch itself must still register.
    if (this.blockSwipe > 0 && !this.pinching) {
      this.tip = { ...rawTip };
      this.prevTip = null;
      this.parkBlade(rawBlade);
      this.wristSamples.length = 0;
      this.blockSwipe -= 1;
    } else {
      this.prevTip = this.tip;
      this.tip = this.tip ? lerpPt(rawTip, this.tip, s) : { ...rawTip };
      this.stepBlade(rawBlade, s);
      this.wristSamples.push({ x: this.wrist.x, y: this.wrist.y, t: now });
      if (this.wristSamples.length > CONFIG.velocityFrames) this.wristSamples.shift();
    }

    this.palmFired = false;
    for (let i = 0; i < FINGERS.length; i++) {
      const ratio = extensionRatio(px, FINGERS[i]);
      this.extended[i] = fingerExtended(ratio, this.extended[i]);
    }
    this.indexOut = this.extended[1];
    const metrics = palmMetrics(px);
    this.palm = palmFacing(metrics, this.label, this.palm);

    const pose = pinchPose(px);
    const mid = lerpPt(px[LM.THUMB_TIP], rawTip, 0.5);

    if (!this.pinching && pose.pinched) {
      this.pinching = true;
      this.pinchStart = mid;
      this.pinchPoint = mid;
      this.pinchAt = now;
      this.notePalm(now);
      this.noteDrum(now);
      this.noteCircle(now);
      return { type: "pinchStart", at: mid, ratio: pose.ratio };
    }
    if (this.pinching && pose.ratio > CONFIG.pinchRelease) {
      this.pinching = false;
      const ev = { type: "pinchEnd", from: this.pinchStart, to: this.pinchPoint };
      this.pinchStart = null;
      this.pinchPoint = null;
      this.rebase();
      this.notePalm(now);
      this.noteDrum(now);
      this.noteCircle(now);
      return ev;
    }
    if (this.pinching) {
      this.pinchPoint = lerpPt(mid, this.pinchPoint, s);
      this.notePalm(now);
      this.noteDrum(now);
      this.noteCircle(now);
      return { type: "pinchMove", from: this.pinchStart, to: this.pinchPoint };
    }
    this.notePalm(now);
    this.noteDrum(now);
    this.noteCircle(now);
    return { type: "move", from: this.prevTip, to: this.tip };
  }

  parkBlade(raws) {
    for (let i = 0; i < this.blade.length; i++) {
      const slot = this.blade[i];
      slot.ready = false;
      slot.tip.x = raws[i].x;
      slot.tip.y = raws[i].y;
    }
  }

  stepBlade(raws, smoothing) {
    for (let i = 0; i < this.blade.length; i++) {
      const slot = this.blade[i];
      const raw = raws[i];
      if (!slot.ready) {
        slot.tip.x = raw.x;
        slot.tip.y = raw.y;
        slot.prev.x = raw.x;
        slot.prev.y = raw.y;
        slot.ready = true;
        continue;
      }
      slot.prev.x = slot.tip.x;
      slot.prev.y = slot.tip.y;
      slot.tip.x = raw.x * (1 - smoothing) + slot.prev.x * smoothing;
      slot.tip.y = raw.y * (1 - smoothing) + slot.prev.y * smoothing;
    }
  }

  /** An open palm facing the camera, held still, clears once per pose. A sweep does not count. */
  notePalm(now) {
    const open = !this.pinching && this.extended.every(Boolean) && this.palm;
    if (!open) {
      this.openSince = null;
      this.palmLatched = false;
      return;
    }
    if (this.tipSpeed() > CONFIG.palmSweepPx) {
      this.openSince = null;
      return;
    }
    if (this.openSince == null) this.openSince = now;
    if (!this.palmLatched && now - this.openSince >= CONFIG.openPalmHoldMs) {
      this.palmLatched = true;
      this.palmFired = true;
    }
  }

  /**
   * A closed fist strikes the drums. Down is the kick, sideways is the snare.
   * Lifting the fist, and any motion below the strike speed, stays silent.
   */
  noteDrum(now) {
    this.drum = null;
    this.shake = false;
    this.loopStamp = false;
    this.loopDrop = false;
    if (!fistClosed(this) || this.blockSwipe > 0) {
      this.drumArmed = false;
      this.shakeFlips = 0;
      this.shakeSign = 0;
      this.loopSince = null;
      this.loopLatched = false;
      this.loopAnchorY = null;
      this.loopDropLatched = false;
      return;
    }
    const motion = this.wristMotion();
    const speed = motion?.speed ?? 0;
    this.noteLoop(now, speed);
    if (!motion) return;
    this.noteShake(now, motion);
    if (motion.speed < CONFIG.drumRearmPx) this.drumArmed = true;
    if (!this.drumArmed || motion.speed < CONFIG.drumStrikePx) return;
    if (now - this.drumAt < CONFIG.drumCooldownMs) return;
    const kind = drumKind(motion.dx, motion.dy);
    if (!kind) return;
    const span = Math.hypot(motion.dx, motion.dy) || 1;
    this.drumArmed = false;
    this.drumAt = now;
    this.shake = false;
    this.drum = kind;
    this.drumDir = { x: motion.dx / span, y: motion.dy / span };
  }

  /**
   * A fist that stays still stamps the bar. Lowering that fist throws the loop away.
   * A strike is faster than this, so a kick or snare does not catch or clear the bar.
   */
  noteLoop(now, speed) {
    if (this.loopAnchorY == null) this.loopAnchorY = this.wrist.y;
    if (speed >= CONFIG.drumStrikePx) {
      this.loopAnchorY = this.wrist.y;
      this.loopSince = null;
      return;
    }
    if (this.wrist.y - this.loopAnchorY >= CONFIG.loopDropPx) {
      if (!this.loopDropLatched) {
        this.loopDropLatched = true;
        this.loopDrop = true;
      }
      this.loopSince = null;
      return;
    }
    if (speed >= CONFIG.drumRearmPx) {
      this.loopSince = null;
      return;
    }
    if (this.loopSince == null) this.loopSince = now;
    if (!this.loopLatched && now - this.loopSince >= CONFIG.loopHoldMs) {
      this.loopLatched = true;
      this.loopStamp = true;
    }
  }

  /** A fist that wiggles in place is a shaker. A full strike stays a kick or snare. */
  noteShake(now, motion) {
    if (motion.speed < CONFIG.shakeMinPx || motion.speed >= CONFIG.drumStrikePx) {
      if (motion.speed < CONFIG.shakeMinPx) {
        this.shakeFlips = 0;
        this.shakeSign = 0;
      }
      return;
    }
    const sign = Math.abs(motion.dx) >= Math.abs(motion.dy) ? Math.sign(motion.dx) : Math.sign(motion.dy);
    if (!sign) return;
    if (this.shakeSign && sign !== this.shakeSign) {
      if (!this.shakeFlips) this.shakeFrom = now;
      this.shakeFlips += 1;
    }
    this.shakeSign = sign;
    if (this.shakeFrom && now - this.shakeFrom > CONFIG.shakeWindowMs) {
      this.shakeFlips = 1;
      this.shakeFrom = now;
    }
    if (this.shakeFlips >= CONFIG.shakeFlips && now - this.drumAt >= CONFIG.drumCooldownMs) {
      this.shake = true;
      this.shakeFlips = 0;
      this.shakeSign = 0;
      this.drumAt = now;
    }
  }

  /** One finger tracing a loop. Any other shape drops the trail. */
  noteCircle(now) {
    this.circle = null;
    const drawing = !this.pinching && !this.blockSwipe && strikeVoice(this) === "harp" && this.tip;
    if (!drawing) {
      this.trace.length = 0;
      return;
    }
    const last = this.trace[this.trace.length - 1];
    if (!last || dist(last, this.tip) >= CONFIG.circleStepPx) {
      this.trace.push({ x: this.tip.x, y: this.tip.y, t: now });
      if (this.trace.length > CONFIG.circlePoints) this.trace.shift();
    }
    while (this.trace.length && now - this.trace[0].t > CONFIG.circleMaxMs) this.trace.shift();
    const found = circleFromPath(this.trace);
    if (!found) return;
    this.circle = found;
    this.trace.length = 0;
  }

  wristMotion() {
    const s = this.wristSamples;
    if (s.length < 2) return null;
    const a = s[0];
    const b = s[s.length - 1];
    const dt = b.t - a.t;
    if (dt < 1) return null;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return { dx, dy, speed: Math.hypot(dx, dy) / dt };
  }
}

/** Thumb–index close, and the middle finger still out. A fist fails the second test. */
function pinchPose(px) {
  const handSize = dist(px[LM.WRIST], px[LM.MIDDLE_MCP]) || 1;
  const ratio = dist(px[LM.THUMB_TIP], px[LM.INDEX_TIP]) / handSize;
  const middle = dist(px[LM.THUMB_TIP], px[LM.MIDDLE_TIP]) / handSize;
  return { ratio, pinched: ratio < CONFIG.pinchStart && middle > ratio * CONFIG.pinchSpread };
}

/**
 * Drop a second detection of the same hand. The higher score wins.
 * @param {{wrist: {x:number,y:number}, score?: number}[]} detections
 */
export function dedupeDetections(detections) {
  const kept = [];
  const ranked = [...detections].sort((a, b) => (b.score || 0) - (a.score || 0));
  for (const d of ranked) {
    if (kept.some((k) => dist(k.wrist, d.wrist) < CONFIG.duplicateHandPx)) continue;
    kept.push(d);
  }
  return kept;
}

/**
 * Pair detections with the hand that was already at that wrist.
 * A Left/Right label flip keeps the same HandState, so one pinch cannot fork into two strings.
 * @param {{label: string, wrist: {x:number,y:number}, score?: number}[]} detections
 * @param {Map<string, HandState>} hands
 */
export function assignHands(detections, hands) {
  const dets = dedupeDetections(detections);
  const entries = [...hands.entries()];
  const seen = new Set();
  const pairs = [];
  const claim = (detection, state) => {
    pairs.push({ detection, state });
    seen.add(state);
  };
  const withWrist = () => entries.filter(([, state]) => state.wrist && !seen.has(state));

  const open = withWrist();
  if (dets.length >= 2 && open.length >= 2) {
    const [d0, d1] = dets;
    const s0 = open[0][1];
    const s1 = open[1][1];
    const direct = dist(s0.wrist, d0.wrist) + dist(s1.wrist, d1.wrist);
    const cross = dist(s0.wrist, d1.wrist) + dist(s1.wrist, d0.wrist);
    const links = cross < direct ? [[d1, s0], [d0, s1]] : [[d0, s0], [d1, s1]];
    for (const [d, state] of links) {
      if (dist(state.wrist, d.wrist) <= CONFIG.handMatchPx) claim(d, state);
    }
  }

  for (const d of dets) {
    if (pairs.some((p) => p.detection === d)) continue;
    let best = null;
    let bestD = Infinity;
    for (const state of withWrist().map(([, s]) => s)) {
      const gap = dist(state.wrist, d.wrist);
      if (gap < bestD) {
        bestD = gap;
        best = state;
      }
    }
    if (best && bestD <= CONFIG.handMatchPx) claim(d, best);
  }

  for (const d of dets) {
    if (pairs.some((p) => p.detection === d)) continue;
    let key = d.label;
    if (hands.has(key) && seen.has(hands.get(key))) {
      key = key === "Left" ? "Right" : key === "Right" ? "Left" : `${key}-2`;
    }
    let state = hands.get(key);
    const far = state?.wrist && dist(state.wrist, d.wrist) > CONFIG.handMatchPx;
    if (!state || seen.has(state) || far) {
      state = new HandState();
      hands.set(key, state);
    }
    claim(d, state);
  }

  return { pairs, seen };
}

/**
 * Tip-to-wrist distance divided by PIP-to-wrist distance.
 * Above 1 the fingertip is farther from the wrist than its middle joint.
 */
export function extensionRatio(px, finger) {
  const wrist = px[LM.WRIST];
  const pip = dist(wrist, px[finger.pip]) || 1;
  return dist(wrist, px[finger.tip]) / pip;
}

/** Hysteresis so a jittering fingertip does not flicker between curled and extended. */
export function fingerExtended(ratio, wasExtended) {
  return ratio > (wasExtended ? CONFIG.extendRelease : CONFIG.extendStart);
}

/** How open and how edge-on the palm is, in the mirrored canvas. */
export function palmMetrics(px) {
  const wrist = px[LM.WRIST];
  const index = px[LM.INDEX_MCP];
  const pinky = px[LM.PINKY_MCP];
  const v1x = index.x - wrist.x;
  const v1y = index.y - wrist.y;
  const v2x = pinky.x - wrist.x;
  const v2y = pinky.y - wrist.y;
  const nz = v1x * v2y - v1y * v2x;
  const area = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1;
  const width = dist(index, pinky) || 1;
  return {
    nz,
    flat: Math.abs(nz) / area,
    depth: Math.abs((index.z || 0) - (pinky.z || 0)) / width,
  };
}

/**
 * Palm toward the camera. In the mirrored view a right palm has a positive
 * normal and a left palm a negative one. An edge-on hand fails the flatness test.
 */
export function palmFacing(metrics, label, wasFacing) {
  const flatEnough = metrics.flat > (wasFacing ? CONFIG.palmFlatRelease : CONFIG.palmFlat);
  if (!flatEnough || metrics.depth > CONFIG.palmDepth) return false;
  if (label === "Left") return metrics.nz < 0;
  if (label === "Right") return metrics.nz > 0;
  return false;
}

/**
 * Which voice a moving hand plays.
 * One finger is the harp, index plus middle is glass, and a flat hand is a chord.
 * @returns {"harp" | "glass" | "chord" | null}
 */
export function strikeVoice(state) {
  const index = state.extended[1];
  const middle = state.extended[2];
  const ring = state.extended[3];
  if (!index) return null;
  if (middle && ring) return "chord";
  if (middle) return "glass";
  return "harp";
}

/** Index, middle, ring, and pinky curled, and not a pinch. The thumb can rest anywhere. */
export function fistClosed(state) {
  return !state.pinching
    && !state.extended[1]
    && !state.extended[2]
    && !state.extended[3]
    && !state.extended[4];
}

/**
 * Downward fist travel is a kick. Sideways travel is a snare. An upward lift is neither.
 * @returns {"kick" | "snare" | null}
 */
export function drumKind(dx, dy) {
  if (dy > 0 && dy >= Math.abs(dx) * CONFIG.drumDownRatio) return "kick";
  if (Math.abs(dx) > Math.abs(dy)) return "snare";
  return null;
}

/** A one-finger swipe. A flat hand is a chord instead, so this stays false then. */
export function canPluck(state) {
  return strikeVoice(state) === "harp";
}

/** Short name for the debug overlay. */
export function gestureLabel(state) {
  if (state.gesture === "nudge") return "retune";
  if (state.gesture === "hold") return "hold";
  if (state.gesture === "mute") return "mute";
  if (state.gesture === "move") return "move";
  if (state.gesture === "span") return "span";
  if (state.gesture === "arm") return state.drone ? "drone" : "ready";
  if (state.gesture === "suppress") return "wait";
  if (state.drum === "kick" || state.drum === "snare") return state.drum;
  if (state.extended.every(Boolean) && state.palm) return "palm";
  if (fistClosed(state) && state.loopLatched) return "loop";
  if (fistClosed(state)) return "fist";
  const voice = strikeVoice(state);
  if (voice === "chord") return "chord";
  if (voice === "glass") return "glass";
  if (voice === "harp") return "pluck";
  return "rest";
}

/**
 * A pinch retunes an end cap, grabs a string body, or waits for the other hand.
 * One pinch in empty space does not create a string. Two of them are joined into one.
 * @param {HandState} state
 * @param {{ drawTaken: boolean, near: object[], cap: {string: object, end: string} | null }} ctx
 */
export function beginPinch(state, { drawTaken, near, cap }) {
  state.grab = null;
  state.span = null;
  state.spanEnd = null;
  if (cap) {
    state.gesture = "nudge";
    state.grab = { string: cap.string, end: cap.end, last: { ...state.pinchPoint } };
    return { drawTaken, mute: [] };
  }
  if (near.length) {
    state.gesture = "hold";
    state.grab = { string: near[0], end: null, last: { ...state.pinchPoint } };
    return { drawTaken, mute: [] };
  }
  state.gesture = "arm";
  return { drawTaken: false, mute: [] };
}
