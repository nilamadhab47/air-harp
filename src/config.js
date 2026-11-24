// All tunable numbers live here. Tweak freely.
export const CONFIG = {
  // MediaPipe
  wasmPath: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
  modelPath:
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
  numHands: 2,
  camera: { width: 1280, height: 720 },
  mirror: true,

  // Gestures (ratios relative to hand size = wrist→middle-MCP distance)
  pinchStart: 0.35, // pinch closes below this
  pinchRelease: 0.55, // pinch opens above this (hysteresis)
  pinchSpread: 1.4, // middle fingertip must be this many times farther from the thumb than the index tip; a fist is not a pinch
  extendStart: 1.18, // tip-to-wrist / pip-to-wrist; a finger is extended above this
  extendRelease: 1.06, // stays extended until the ratio falls under this
  palmFlat: 0.42, // palm triangle spread; an edge-on hand is below this
  palmFlatRelease: 0.28,
  palmDepth: 0.7, // index-to-pinky depth / width; larger means the palm is turned sideways
  openPalmHoldMs: 800, // open palm, facing the camera, held this long clears the harp
  palmSweepPx: 0.3, // px/ms; a faster open hand is a strum, not the clear hold
  droneHoldMs: 320, // a lone pinch held this long starts the drone
  droneRadius: 160, // px; the drone follows the nearest string inside this reach
  capGrabPx: 20, // pinch this close to an end cap to drag that end
  grabSlopPx: 22, // a body pinch that travels this far moves the string
  muteHoldMs: 160, // a body pinch that stays inside the slop mutes instead
  grabMinPx: 28, // endpoints cannot be dragged closer than this
  wipeMs: 900, // open-palm clear sweeps across the frame
  wipeBand: 110, // px of the fade at the leading edge of the wipe
  minStringLength: 80, // px; shorter drags are discarded
  smoothing: 0.5, // 0 = no smoothing, 0.9 = very smooth (laggy)
  appearSettleFrames: 2, // swipe segments dropped when a hand first appears
  gapSettleFrames: 1, // swipe segments dropped after a pinch release or a tracking gap
  handLostMs: 300, // forget a hand only after it has been gone this long
  duplicateHandPx: 130, // closer than this, two detections are the same hand
  handMatchPx: 420, // how far a wrist may jump and still be the same hand
  cameraTimeoutMs: 3000,

  // Plucking
  pluckCooldownMs: 160,
  maxStrings: 24,
  velocityFrames: 4, // fingertip samples used for swipe speed
  velocityKnee: 1.25, // px/ms; larger = slower swipes stay quieter
  strumStaggerMs: 12, // delay between strings hit by one finger
  chordStaggerMs: 4, // a flat-hand strum speaks almost together
  chordFloor: 0.45, // a section hit stays audible even when the sweep is gentle
  drumStrikePx: 0.85, // px/ms; a closed fist must move at least this fast to hit
  drumRearmPx: 0.4, // the fist has to ease off before the next hit counts
  drumDownRatio: 1.15, // downward travel vs sideways; more than this is a kick, else a snare
  drumCooldownMs: 150,
  shakeMinPx: 0.22, // px/ms; a fist wiggle, quieter than a strike
  shakeFlips: 4, // direction changes inside the window
  shakeWindowMs: 480,
  circleStepPx: 16, // a still finger does not add another sample
  circlePoints: 100,
  circleMinPoints: 12,
  circleMinMs: 280,
  circleMaxMs: 2000,
  circleMinR: 36,
  circleHatR: 78, // smaller than this is a hi-hat
  circleTomR: 140, // smaller than this is a tom; larger is a kick
  circleMaxR: 230,
  circleClose: 0.42, // end must return within this fraction of the radius
  circleRound: 0.36, // radius variation; higher allows a rougher circle
  circleMinTurn: 4.8, // radians around the center, just under a full turn
  circleCoverage: 0.62, // path length compared with the circumference
  padCooldownMs: 150,
  padMax: 6,
  muteRadius: 15, // px; a pinch that starts this close to a string mutes it
  muteDecayMs: 110, // visual collapse after a mute
  muteRampSec: 0.05, // audio gain ramp when muting
  pluckAttackSec: 0.004, // short attack so a mute ramp cannot click

  // Sound
  scaleId: "major-pentatonic",
  scale: [0, 2, 4, 7, 9], // major pentatonic (semitones)
  root: 0, // pitch class of the lowest note
  baseMidi: 48, // C3 = lowest note (longest string)
  octaves: 3,
  octaveMin: 1,
  octaveMax: 5,
  spelling: "sharp",
  masterGain: 0.6,
  droneGain: 0.14, // tanpura level into the master, before the hand sets the volume
  droneLevelMin: 0.18, // master gain with the drone hand at the bottom of the frame
  droneLevelMax: 0.9, // master gain with the drone hand at the top
  decay: 0.996, // Karplus–Strong harp feedback (closer to 1 = longer ring)
  reverb: 0.25, // delay feedback; the panel moves this
  reverbFull: 0.25, // this amount is the original fully wet echo
  reverbMax: 0.55,
  timbre: "harp", // harp | bass | glass
  bassDecay: 0.992, // lower than harp, so the bass note dies a little sooner
  bassPole: 0.62, // one-pole low-pass inside the bass string (1 = bright)
  glassDecay: 3.6, // exponential falloff of the glass partials
  glassMix: 0.34,
  glassPartials: [1, 2.76, 5.4, 8.93],
  glassAmps: [1, 0.34, 0.15, 0.06],
  drumGain: 0.7,
  kickHz: 156, // pitch at the attack
  kickFloorHz: 46, // pitch the kick falls to
  kickSweep: 14, // how fast that pitch drops
  kickDecay: 8,
  kickClick: 0.4,
  kickSec: 0.42,
  snareHz: 188,
  snareBody: 0.42,
  snareBodyDecay: 24,
  snareDecay: 15,
  snareNoise: 0.72,
  snarePole: 0.8,
  snareSec: 0.28,
  hatSec: 0.16,
  tomSec: 0.4,
  tomHzTop: 210, // a tom placed at the top of the frame
  tomHzBottom: 92, // a tom placed at the bottom
  shakerSec: 0.16,
  loopCaptureMs: 4000, // how far back a still fist looks for the bar
  loopMinEvents: 2,
  loopBeats: 4,
  loopSteps: 16,
  loopSwing: 0.33, // odd 16ths land late, so the bar swings
  loopDefaultBeatMs: 500,
  loopBeatMinMs: 300, // fastest tempo the loop will choose
  loopBeatMaxMs: 1000,
  loopGapMinMs: 90, // closer than this is a flam, not a beat
  loopGapMaxMs: 1500,
  loopHoldMs: 480, // a still fist, held, stamps the bar
  loopDropPx: 110, // a fist lowered this far throws the loop away
  loopSoonMs: 160, // the next hit lights up this early
  answerHoldMs: 240, // rest on a plucked string and it walks up the scale
  answerRadius: 42,
  answerNotes: 2, // notes after the one already played
  answerStepLeftMs: 340, // left side of the frame walks slowly
  answerStepRightMs: 150,
  answerVelLeft: 0.42,
  answerVelRight: 0.9,
  sympathyPx: 190, // neighbors this close whisper the plucked note
  sympathyMax: 3,
  sympathyGain: 0.16,
  sympathyAmp: 0.2,
  snap: false,
  grid: 40, // px, used when snap is on
  pitchLabels: false,

  // Visuals
  segments: 48, // points per string when drawn vibrating
  vibAmp: 22, // px, initial pluck amplitude
  vibDecayMs: 900,
  vibFreq: 0.045, // visual wobble speed
  tickSpacing: 28, // px between tick marks
  glow: 18, // wide bloom radius, full-res px
  bloomScale: 0.5, // offscreen bloom buffer, relative to the canvas
  bloomTight: 0.32, // tight bloom pass, as a fraction of the wide radius
  shimmerPx: 1.6, // chromatic copy offset while a string is vibrating
  shimmerHue: 25,
  shimmerAlpha: 0.32,
  crackleMs: 120, // strong-pluck lightning along the string
  crackleVelocity: 0.8,
  crackleAmp: 9, // px of random sideways kick
  noteFloatMs: 700,
  lightningPerPluck: 4,
  lightningLen: 22,
  flashDecay: 0.18, // per frame; the contact flash is gone in about 100 ms
  particlesPerPluck: 26,
  toastMs: 1500, // visible time before the toast fades
  toastFadeMs: 400,

  // Recording. The bitrate stays moderate so encoding can keep the harp above 50 fps.
  recordFps: 60,
  recordVideoBits: 2500000,
  recordAudioBits: 128000,
};

/** Scales the panel can select. CONFIG.scale stays the live interval list. */
export const SCALES = [
  { id: "major-pentatonic", name: "Major pentatonic", steps: [0, 2, 4, 7, 9] },
  { id: "minor-pentatonic", name: "Minor pentatonic", steps: [0, 3, 5, 7, 10] },
  { id: "major", name: "Major", steps: [0, 2, 4, 5, 7, 9, 11] },
  { id: "natural-minor", name: "Natural minor", steps: [0, 2, 3, 5, 7, 8, 10] },
  { id: "hirajoshi", name: "Hirajoshi", steps: [0, 2, 3, 7, 8] },
  { id: "bhairav", name: "Bhairav", steps: [0, 1, 4, 5, 7, 8, 11] },
];

/** Root notes. The lowest string stays in octave 3; only the pitch class moves. */
export const ROOTS = [
  { pc: 0, name: "C" }, { pc: 1, name: "C#" }, { pc: 2, name: "D" },
  { pc: 3, name: "Eb" }, { pc: 4, name: "E" }, { pc: 5, name: "F" },
  { pc: 6, name: "F#" }, { pc: 7, name: "G" }, { pc: 8, name: "Ab" },
  { pc: 9, name: "A" }, { pc: 10, name: "Bb" }, { pc: 11, name: "B" },
];
