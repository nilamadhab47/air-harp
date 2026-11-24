import { CONFIG } from "./config.js";
import { dist } from "./geometry.js";

/**
 * A closed one-finger loop. Size picks the drum: small hat, middle tom, large kick.
 * Returns null until the path is round, closed, and has gone most of the way around.
 * @param {{x:number,y:number,t:number}[]} points
 * @returns {{x:number,y:number,r:number,kind:"hat"|"tom"|"kick"} | null}
 */
export function circleFromPath(points) {
  if (!points || points.length < CONFIG.circleMinPoints) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const span = last.t - first.t;
  if (span < CONFIG.circleMinMs || span > CONFIG.circleMaxMs) return null;

  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  x /= points.length;
  y /= points.length;

  let mean = 0;
  for (const p of points) mean += Math.hypot(p.x - x, p.y - y);
  mean /= points.length;
  if (mean < CONFIG.circleMinR || mean > CONFIG.circleMaxR) return null;
  if (Math.hypot(last.x - first.x, last.y - first.y) > mean * CONFIG.circleClose) return null;

  let varSum = 0;
  let turn = 0;
  let length = 0;
  let prevA = Math.atan2(first.y - y, first.x - x);
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const rad = Math.hypot(p.x - x, p.y - y);
    const deltaR = rad - mean;
    varSum += deltaR * deltaR;
    if (i === 0) continue;
    const q = points[i - 1];
    length += Math.hypot(p.x - q.x, p.y - q.y);
    const a = Math.atan2(p.y - y, p.x - x);
    let delta = a - prevA;
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    turn += delta;
    prevA = a;
  }
  if (Math.sqrt(varSum / points.length) / mean > CONFIG.circleRound) return null;
  if (Math.abs(turn) < CONFIG.circleMinTurn) return null;
  if (length < mean * Math.PI * 2 * CONFIG.circleCoverage) return null;
  return { x, y, r: mean, kind: padKind(mean) };
}

/** @returns {"hat" | "tom" | "kick"} */
export function padKind(radius) {
  if (radius < CONFIG.circleHatR) return "hat";
  if (radius < CONFIG.circleTomR) return "tom";
  return "kick";
}

/** Higher on the frame is a higher tom. */
export function tomFreq(y, height) {
  const t = Math.min(1, Math.max(0, y / (height || 1)));
  return CONFIG.tomHzTop + (CONFIG.tomHzBottom - CONFIG.tomHzTop) * t;
}

/** Drums the player has drawn. Not saved across a refresh. */
export class DrumKit {
  constructor() {
    this.pads = [];
  }

  add(circle, freq, now) {
    const pad = {
      x: circle.x,
      y: circle.y,
      r: circle.r,
      kind: circle.kind,
      freq,
      hue: circle.kind === "hat" ? 168 : circle.kind === "tom" ? 36 : 10,
      hitAt: -1,
      born: now,
    };
    this.pads.push(pad);
    if (this.pads.length > CONFIG.padMax) this.pads.shift();
    return pad;
  }

  clear() {
    this.pads.length = 0;
  }

  /**
   * Smallest pad a fingertip enters from outside.
   * @param {{x:number,y:number} | null} from
   * @param {{x:number,y:number} | null} to
   */
  enter(from, to, now) {
    if (!from || !to) return null;
    let best = null;
    for (const pad of this.pads) {
      if (now - pad.hitAt < CONFIG.padCooldownMs) continue;
      if (dist(from, pad) <= pad.r || dist(to, pad) > pad.r) continue;
      if (!best || pad.r < best.r) best = pad;
    }
    if (best) best.hitAt = now;
    return best;
  }

  /**
   * Smallest pad that already contains the fist.
   * @param {({x:number,y:number} | null)[]} points
   */
  contains(points, now) {
    let best = null;
    for (const pad of this.pads) {
      if (now - pad.hitAt < CONFIG.padCooldownMs) continue;
      if (!points.some((p) => p && dist(p, pad) <= pad.r)) continue;
      if (!best || pad.r < best.r) best = pad;
    }
    if (best) best.hitAt = now;
    return best;
  }
}
