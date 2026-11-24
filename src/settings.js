import { CONFIG, ROOTS, SCALES } from "./config.js";

const KEY = "air-harp-v1";
const TIMBRES = ["harp", "bass", "glass"];
const FLAT_INTERVALS = new Set([1, 3, 6, 8, 10]);
const FLAT_ROOTS = new Set([1, 3, 5, 6, 8, 10]);

/**
 * Flats when the scale itself uses a flat interval, otherwise when the root
 * is a flat key (F, Bb, Eb, Ab, Db, Gb). Everything else stays sharp.
 */
export function spellingFor(rootPc, steps) {
  if (steps.some((step) => FLAT_INTERVALS.has(step))) return "flat";
  if (FLAT_ROOTS.has(rootPc)) return "flat";
  return "sharp";
}

function clamp(n, lo, hi, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.min(hi, Math.max(lo, x));
}

/** Copy of the values the panel is allowed to change. */
export function currentSettings() {
  return {
    scaleId: CONFIG.scaleId,
    root: CONFIG.root,
    octaves: CONFIG.octaves,
    reverb: CONFIG.reverb,
    timbre: CONFIG.timbre,
    snap: CONFIG.snap,
    pitchLabels: CONFIG.pitchLabels,
  };
}

/**
 * Write panel values onto CONFIG. Missing or unknown fields keep the current value.
 * @param {Partial<ReturnType<typeof currentSettings>>} partial
 */
export function applySettings(partial = {}) {
  const scale = SCALES.find((s) => s.id === partial.scaleId)
    ?? SCALES.find((s) => s.id === CONFIG.scaleId)
    ?? SCALES[0];
  const rootPc = Number(partial.root);
  const root = ROOTS.some((r) => r.pc === rootPc) ? rootPc : CONFIG.root;
  const octaves = Math.round(clamp(partial.octaves, CONFIG.octaveMin, CONFIG.octaveMax, CONFIG.octaves));
  const reverb = clamp(partial.reverb, 0, CONFIG.reverbMax, CONFIG.reverb);
  const timbre = TIMBRES.includes(partial.timbre) ? partial.timbre : CONFIG.timbre;

  CONFIG.scaleId = scale.id;
  CONFIG.scale = scale.steps.slice();
  CONFIG.root = root;
  CONFIG.octaves = octaves;
  CONFIG.reverb = reverb;
  CONFIG.timbre = timbre;
  CONFIG.snap = typeof partial.snap === "boolean" ? partial.snap : CONFIG.snap;
  CONFIG.pitchLabels = typeof partial.pitchLabels === "boolean" ? partial.pitchLabels : CONFIG.pitchLabels;
  CONFIG.spelling = spellingFor(root, CONFIG.scale);
  return currentSettings();
}

/** @returns {{ settings: object, hadStrings: boolean } | null} */
export function readSaved() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    const settings = data.settings && typeof data.settings === "object" ? data.settings : {};
    const hadStrings = Array.isArray(data.strings) && data.strings.length > 0;
    return { settings, hadStrings };
  } catch {
    return null;
  }
}

/** Persist Tune settings only. Strings belong to the current visit and are not saved. */
export function writeSaved(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ settings }));
  } catch {
    // Private mode or a full quota. The instrument still plays.
  }
}

/** Wire the Tune panel. Does not emit a change while filling the form. */
export function bindPanel(onChange) {
  const toggle = document.getElementById("panelToggle");
  const body = document.getElementById("panelBody");
  const scaleSel = document.getElementById("setScale");
  const rootSel = document.getElementById("setRoot");
  const octaves = document.getElementById("setOctaves");
  const reverb = document.getElementById("setReverb");
  const timbre = document.getElementById("setTimbre");
  const labels = document.getElementById("setLabels");
  const snap = document.getElementById("setSnap");
  const octaveRead = document.getElementById("octaveRead");
  const reverbRead = document.getElementById("reverbRead");

  for (const scale of SCALES) {
    const option = document.createElement("option");
    option.value = scale.id;
    option.textContent = scale.name;
    scaleSel.appendChild(option);
  }
  for (const root of ROOTS) {
    const option = document.createElement("option");
    option.value = String(root.pc);
    option.textContent = root.name;
    rootSel.appendChild(option);
  }
  octaves.min = String(CONFIG.octaveMin);
  octaves.max = String(CONFIG.octaveMax);
  octaves.step = "1";
  reverb.min = "0";
  reverb.max = String(CONFIG.reverbMax);
  reverb.step = "0.01";

  function readForm() {
    return {
      scaleId: scaleSel.value,
      root: Number(rootSel.value),
      octaves: Number(octaves.value),
      reverb: Number(reverb.value),
      timbre: timbre.value,
      pitchLabels: labels.checked,
      snap: snap.checked,
    };
  }

  function paintReads() {
    octaveRead.textContent = octaves.value;
    reverbRead.textContent = Number(reverb.value).toFixed(2);
  }

  function writeForm(settings) {
    scaleSel.value = settings.scaleId;
    rootSel.value = String(settings.root);
    octaves.value = String(settings.octaves);
    reverb.value = String(settings.reverb);
    timbre.value = settings.timbre;
    labels.checked = !!settings.pitchLabels;
    snap.checked = !!settings.snap;
    paintReads();
  }

  function emit() {
    paintReads();
    onChange(readForm());
  }

  scaleSel.addEventListener("change", emit);
  rootSel.addEventListener("change", emit);
  octaves.addEventListener("input", paintReads);
  octaves.addEventListener("change", emit);
  reverb.addEventListener("input", emit);
  timbre.addEventListener("change", emit);
  labels.addEventListener("change", emit);
  snap.addEventListener("change", emit);
  toggle.addEventListener("click", () => {
    const open = body.hidden;
    body.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  });

  writeForm(currentSettings());
}
