import { CONFIG } from "./config.js";
import { gestureLabel } from "./gestures.js";

const HAND_EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

export function drawVideo(ctx, video, w, h) {
  ctx.save();
  if (CONFIG.mirror) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, w, h);
  ctx.restore();
  // Darken slightly so the glow pops.
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(0, 0, w, h);
}

/**
 * Concert wash over the camera. Beams drift on their own.
 * A plucked string, or a drum hit, flashes the room in that color.
 */
export function drawDisco(ctx, strings, pads, now, w, h) {
  const hueA = (now / CONFIG.discoCycleMs) * 360;
  const hueB = hueA + 150;
  let flash = 0;
  let flashHue = hueA;
  let fx = w * 0.5;
  let fy = h * 0.45;
  for (const s of strings) {
    const e = s.energy(now) * s.amp;
    if (e <= flash) continue;
    flash = e;
    flashHue = s.hue;
    fx = s.labelX == null ? (s.a.x + s.b.x) / 2 : s.labelX;
    fy = s.labelY == null ? (s.a.y + s.b.y) / 2 : s.labelY;
  }
  for (const pad of pads) {
    const age = now - pad.hitAt;
    if (age < 0 || age > CONFIG.discoFlashMs) continue;
    const e = 1 - age / CONFIG.discoFlashMs;
    if (e <= flash) continue;
    flash = e;
    flashHue = pad.hue;
    fx = pad.x;
    fy = pad.y;
  }

  const wash = Math.min(0.72, CONFIG.discoWash + flash * CONFIG.discoWashKick);
  ctx.save();
  ctx.globalCompositeOperation = "overlay";
  ctx.fillStyle = `hsla(${hueA}, 95%, 48%, ${wash})`;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "screen";
  beam(ctx, w * (0.15 + 0.7 * (0.5 + 0.5 * Math.sin(now / CONFIG.discoSweepMs))), 0, w, h, hueA, CONFIG.discoIdle);
  beam(ctx, w * (0.85 - 0.7 * (0.5 + 0.5 * Math.cos(now / (CONFIG.discoSweepMs * 1.37)))), h, w, h, hueB, CONFIG.discoIdle * 0.85);
  if (flash > 0.05) {
    const reach = Math.max(w, h) * 0.62;
    const burst = ctx.createRadialGradient(fx, fy, 0, fx, fy, reach);
    const alpha = Math.min(CONFIG.discoFlash, flash * CONFIG.discoFlash);
    burst.addColorStop(0, `hsla(${flashHue}, 100%, 68%, ${alpha})`);
    burst.addColorStop(1, `hsla(${flashHue}, 100%, 42%, 0)`);
    ctx.fillStyle = burst;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

function beam(ctx, x, y, w, h, hue, alpha) {
  const g = ctx.createLinearGradient(x, y, x + w * 0.22, h * 0.5);
  g.addColorStop(0, `hsla(${hue}, 100%, 64%, 0)`);
  g.addColorStop(0.5, `hsla(${hue}, 100%, 66%, ${alpha})`);
  g.addColorStop(1, `hsla(${hue + 36}, 100%, 52%, 0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

export function drawHand(ctx, px) {
  ctx.save();
  ctx.strokeStyle = "#34e05a";
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (const [a, b] of HAND_EDGES) {
    ctx.moveTo(px[a].x, px[a].y);
    ctx.lineTo(px[b].x, px[b].y);
  }
  ctx.stroke();
  for (const p of px) {
    ctx.fillStyle = "#e0243a";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Wrist label and the open-palm hold bar. Drawn only while debug is on. */
export function drawGestureState(ctx, state, now) {
  if (!state.wrist) return;
  const progress = state.openSince == null ? 0 : Math.min(1, (now - state.openSince) / CONFIG.openPalmHoldMs);
  const bits = state.extended.map((on) => (on ? "1" : "0")).join("");
  ctx.save();
  ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "rgba(8, 12, 22, 0.72)";
  ctx.fillRect(state.wrist.x + 8, state.wrist.y - 28, 92, 18);
  ctx.fillStyle = "rgba(201, 246, 255, 0.95)";
  ctx.fillText(`${gestureLabel(state)} ${bits}`, state.wrist.x + 12, state.wrist.y - 14);
  if (progress > 0 && progress < 1) {
    ctx.fillStyle = "rgba(110, 231, 255, 0.25)";
    ctx.fillRect(state.wrist.x + 12, state.wrist.y - 8, 48, 3);
    ctx.fillStyle = "rgba(110, 231, 255, 0.95)";
    ctx.fillRect(state.wrist.x + 12, state.wrist.y - 8, 48 * progress, 3);
  }
  ctx.restore();
}

/** Leading edge of the open-palm wipe. `x` moves from the left of the frame to the right. */
export function drawWipe(ctx, w, h, x) {
  const band = CONFIG.wipeBand;
  const fade = ctx.createLinearGradient(x - band, 0, x + 16, 0);
  fade.addColorStop(0, "rgba(110, 231, 255, 0)");
  fade.addColorStop(0.72, "rgba(110, 231, 255, 0.16)");
  fade.addColorStop(1, "rgba(255, 255, 255, 0.5)");
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = fade;
  ctx.fillRect(x - band, 0, band + 16, h);
  ctx.restore();
}

const PTS = [];
let glowCanvas = null;
let glowCtx = null;
let scratchCanvas = null;
let scratchCtx = null;

function ensureBloom(w, h) {
  const bw = Math.max(2, Math.round(w * CONFIG.bloomScale));
  const bh = Math.max(2, Math.round(h * CONFIG.bloomScale));
  if (!glowCanvas || glowCanvas.width !== bw || glowCanvas.height !== bh) {
    glowCanvas = document.createElement("canvas");
    glowCanvas.width = bw;
    glowCanvas.height = bh;
    glowCtx = glowCanvas.getContext("2d");
    scratchCanvas = document.createElement("canvas");
    scratchCanvas.width = bw;
    scratchCanvas.height = bh;
    scratchCtx = scratchCanvas.getContext("2d");
  }
  return { bw, bh };
}

/** Points along the string, displaced by a decaying standing wave. Reuses one point buffer. */
function stringPoints(s, now) {
  const n = CONFIG.segments;
  while (PTS.length <= n) PTS.push({ x: 0, y: 0 });
  let e = s.energy(now) * s.amp;
  if (s.soon != null && now - s.soon >= 0 && now - s.soon < CONFIG.loopSoonMs) e = Math.max(e, 0.55);
  const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const age = now - s.pluckedAt;
  const wobble = CONFIG.vibFreq * (0.6 + s.freq / 400);
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const shape =
      Math.sin(Math.PI * u) * Math.cos(wobble * age) +
      0.35 * Math.sin(2 * Math.PI * u) * Math.cos(2 * wobble * age) * (s.pluckT - 0.5) * 2;
    const off = e > 0.002 ? CONFIG.vibAmp * e * shape * s.direction : 0;
    PTS[i].x = s.a.x + dx * u + nx * off;
    PTS[i].y = s.a.y + dy * u + ny * off;
  }
  return { pts: PTS, n, e, nx, ny, len, age };
}

function trace(ctx, pts, n, ox, oy) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x + ox, pts[0].y + oy);
  for (let i = 1; i <= n; i++) ctx.lineTo(pts[i].x + ox, pts[i].y + oy);
}

function blurOnto(ctx, source, radius, bw, bh, w, h) {
  scratchCtx.setTransform(1, 0, 0, 1, 0, 0);
  scratchCtx.clearRect(0, 0, bw, bh);
  scratchCtx.filter = `blur(${radius}px)`;
  scratchCtx.drawImage(source, 0, 0);
  scratchCtx.filter = "none";
  ctx.drawImage(scratchCanvas, 0, 0, w, h);
}

/**
 * All strings: two bloom passes from a half-resolution buffer, then the sharp
 * string, chromatic copies, crackle, and the floating note name.
 */
function stringFade(s, wipeX) {
  if (wipeX == null) return 1;
  const mid = (s.a.x + s.b.x) / 2;
  return Math.min(1, Math.max(0, (mid - (wipeX - CONFIG.wipeBand)) / CONFIG.wipeBand));
}

export function drawStrings(ctx, strings, now, w, h, wipeX = null) {
  if (!strings.length) return;
  const { bw, bh } = ensureBloom(w, h);
  const scale = CONFIG.bloomScale;
  glowCtx.setTransform(1, 0, 0, 1, 0, 0);
  glowCtx.clearRect(0, 0, bw, bh);
  glowCtx.setTransform(scale, 0, 0, scale, 0, 0);
  glowCtx.globalCompositeOperation = "lighter";
  glowCtx.lineCap = "round";
  glowCtx.lineJoin = "round";
  for (const s of strings) {
    const fade = stringFade(s, wipeX);
    if (fade <= 0.02) continue;
    const g = stringPoints(s, now);
    glowCtx.globalAlpha = fade;
    glowCtx.strokeStyle = `hsl(${s.hue}, 100%, ${68 + 22 * Math.min(1, g.e)}%)`;
    glowCtx.lineWidth = 3.2 + 5 * g.e;
    trace(glowCtx, g.pts, g.n, 0, 0);
    glowCtx.stroke();
  }
  glowCtx.globalAlpha = 1;

  const wide = CONFIG.glow * scale;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  blurOnto(ctx, glowCanvas, wide, bw, bh, w, h);
  blurOnto(ctx, glowCanvas, wide * CONFIG.bloomTight, bw, bh, w, h);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of strings) {
    const fade = stringFade(s, wipeX);
    if (fade <= 0.02) continue;
    drawStringBody(ctx, s, now, fade);
  }
  ctx.restore();

  ctx.save();
  ctx.font = "600 15px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  for (const s of strings) {
    const fade = stringFade(s, wipeX);
    if (fade <= 0.02) continue;
    ctx.globalAlpha = fade;
    if (CONFIG.pitchLabels || CONFIG.songId !== "off") {
      ctx.fillStyle = `hsla(${s.hue}, 100%, 86%, 0.88)`;
      ctx.fillText(s.name, (s.a.x + s.b.x) / 2, (s.a.y + s.b.y) / 2 - 8);
    }
    drawNoteLabel(ctx, s, now);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function drawStringBody(ctx, s, now, fade) {
  const { pts, n, e, nx, ny, len, age } = stringPoints(s, now);
  if (e > 0.03) {
    const o = CONFIG.shimmerPx * (0.4 + e);
    ctx.globalAlpha = fade * CONFIG.shimmerAlpha * Math.min(1, 0.45 + e);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = `hsl(${s.hue + CONFIG.shimmerHue}, 100%, 72%)`;
    trace(ctx, pts, n, nx * o, ny * o);
    ctx.stroke();
    ctx.strokeStyle = `hsl(${s.hue - CONFIG.shimmerHue}, 100%, 72%)`;
    trace(ctx, pts, n, -nx * o, -ny * o);
    ctx.stroke();
  }

  ctx.globalAlpha = fade;
  ctx.strokeStyle = `hsl(${s.hue}, 100%, ${70 + 20 * Math.min(1, e)}%)`;
  ctx.lineWidth = 2 + 3 * e;
  trace(ctx, pts, n, 0, 0);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  const ticks = Math.floor(len / CONFIG.tickSpacing);
  for (let i = 1; i < ticks; i++) {
    const u = i / ticks;
    const x = s.a.x + (s.b.x - s.a.x) * u;
    const y = s.a.y + (s.b.y - s.a.y) * u;
    const k = i % 4 === 0 ? 7 : 4;
    ctx.moveTo(x - nx * k, y - ny * k);
    ctx.lineTo(x + nx * k, y + ny * k);
  }
  for (const p of [s.a, s.b]) {
    ctx.moveTo(p.x - nx * 10, p.y - ny * 10);
    ctx.lineTo(p.x + nx * 10, p.y + ny * 10);
  }
  ctx.stroke();

  if (s.amp > CONFIG.crackleVelocity && age >= 0 && age < CONFIG.crackleMs) {
    const crack = 1 - age / CONFIG.crackleMs;
    const mag = CONFIG.crackleAmp * crack;
    ctx.globalAlpha = fade * 0.9 * crack;
    ctx.strokeStyle = `hsl(${s.hue}, 100%, 90%)`;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const j = (Math.random() - 0.5) * 2 * mag;
      const x = pts[i].x + nx * j;
      const y = pts[i].y + ny * j;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawNoteLabel(ctx, s, now) {
  if (s.labelX == null) return;
  const age = now - s.pluckedAt;
  if (age < 0 || age > CONFIG.noteFloatMs) return;
  const fade = 1 - age / CONFIG.noteFloatMs;
  ctx.fillStyle = `hsla(${s.hue}, 100%, 88%, ${fade})`;
  ctx.fillText(s.sung || s.name, s.labelX, s.labelY - 14 - age * 0.028);
}

/** Placed drums and the finger trail of a circle that has not closed yet. */
export function drawPads(ctx, pads, traces, now) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const pad of pads) {
    const age = pad.hitAt < 0 ? 999 : now - pad.hitAt;
    const hot = age < 220 || (pad.soon != null && now - pad.soon >= 0 && now - pad.soon < CONFIG.loopSoonMs);
    ctx.strokeStyle = `hsla(${pad.hue}, 100%, 70%, 0.9)`;
    ctx.lineWidth = hot ? 4 : 2;
    ctx.beginPath();
    ctx.arc(pad.x, pad.y, pad.r, 0, Math.PI * 2);
    ctx.stroke();
    if (hot) {
      const k = age / 220;
      ctx.globalAlpha = 1 - k;
      ctx.beginPath();
      ctx.arc(pad.x, pad.y, pad.r * (0.35 + 0.65 * k), 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = `hsla(${pad.hue}, 100%, 88%, 0.85)`;
    ctx.fillText("drum", pad.x, pad.y);
  }
  ctx.strokeStyle = "rgba(126, 240, 255, 0.55)";
  ctx.lineWidth = 2;
  for (const points of traces) {
    if (!points || points.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawCursor(ctx, p, pinching) {
  ctx.save();
  ctx.strokeStyle = pinching ? "#ffd166" : "rgba(255,255,255,0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(p.x, p.y, pinching ? 10 : 7, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
