import { CONFIG } from "./config.js";
import { dist, distToSegment, segmentsCross, segmentIntersection, projectT } from "./geometry.js";
import { lengthToNote } from "./audio.js";

let nextId = 1;

export class HarpString {
  constructor(a, b, maxLength) {
    this.id = nextId++;
    this.a = a;
    this.b = b;
    this.length = dist(a, b);
    const note = lengthToNote(this.length, maxLength);
    this.freq = note.freq;
    this.midi = note.midi;
    this.name = note.name;
    this.hue = (this.freq * 0.7) % 360; // same pitch → same color
    this.pluckedAt = -Infinity;
    this.pluckT = 0.5; // where along the string it was hit
    this.amp = 0;
    this.direction = 1;
    this.muted = false;
    this.labelX = null;
    this.labelY = null;
    this.draft = false;
    this.settled = false;
  }

  /** Current displacement envelope (0..1). A future pluck (strum delay) stays at rest. */
  energy(now) {
    const age = now - this.pluckedAt;
    if (age < 0) return 0;
    const decay = this.muted ? CONFIG.muteDecayMs : CONFIG.vibDecayMs;
    return Math.exp(-age / decay);
  }

  /** Collapse the vibration from its current height. Returns false if it is already muting. */
  damp(now) {
    if (this.muted) return false;
    this.amp *= this.energy(now);
    this.pluckedAt = now;
    this.muted = true;
    return true;
  }
}

/** Soft 0..1 map from swipe speed. Fast swipes approach 1; slow ones stay quiet. */
export function velocityCurve(pxPerMs) {
  const x = Math.max(0, pxPerMs);
  return 1 - Math.exp(-x / CONFIG.velocityKnee);
}

export class StringField {
  constructor() {
    this.strings = [];
  }

  add(a, b, maxLength) {
    if (dist(a, b) < CONFIG.minStringLength) return null;
    const s = new HarpString(a, b, maxLength);
    this.strings.push(s);
    if (this.strings.length > CONFIG.maxStrings) this.strings.shift();
    return s;
  }

  undo() {
    this.strings.pop();
  }

  clear() {
    this.strings.length = 0;
  }

  /** Re-quantize every string after the scale, root, or octave range changes. */
  retune(maxLength) {
    for (const s of this.strings) {
      this.applyNote(s, maxLength);
    }
  }

  /** A string that follows two pinch points. It is dropped on release if it is still too short. */
  place(a, b, maxLength) {
    const s = new HarpString({ x: a.x, y: a.y }, { x: b.x, y: b.y }, maxLength);
    s.draft = true;
    this.strings.push(s);
    return s;
  }

  /**
   * Keep a draft string once a hand lets go. A second call for the same string does nothing.
   * @returns {HarpString | null}
   */
  finishSpan(s) {
    if (!s || s.settled) return null;
    s.settled = true;
    s.draft = false;
    if (s.length < CONFIG.minStringLength) {
      this.remove(s);
      return null;
    }
    while (this.strings.length > CONFIG.maxStrings) {
      const drop = this.strings.findIndex((item) => item !== s);
      if (drop < 0) break;
      this.strings.splice(drop, 1);
    }
    return s;
  }

  remove(s) {
    const i = this.strings.indexOf(s);
    if (i >= 0) this.strings.splice(i, 1);
  }

  /** Nearest end cap within radius, or null. */
  capAt(p, radius) {
    let best = null;
    let bestD = radius;
    for (const s of this.strings) {
      for (const end of ["a", "b"]) {
        const gap = dist(p, s[end]);
        if (gap <= bestD) {
          best = { string: s, end };
          bestD = gap;
        }
      }
    }
    return best;
  }

  /** Drag one endpoint and retune. The ends stay at least grabMinPx apart. */
  setEnd(s, end, p, maxLength) {
    const other = end === "a" ? s.b : s.a;
    let x = p.x;
    let y = p.y;
    let gap = Math.hypot(x - other.x, y - other.y);
    if (gap < CONFIG.grabMinPx) {
      if (gap < 0.001) {
        x = other.x + CONFIG.grabMinPx;
        y = other.y;
      } else {
        const k = CONFIG.grabMinPx / gap;
        x = other.x + (x - other.x) * k;
        y = other.y + (y - other.y) * k;
      }
      gap = CONFIG.grabMinPx;
    }
    s[end].x = x;
    s[end].y = y;
    s.length = gap;
    this.applyNote(s, maxLength);
  }

  /** Slide a string without changing its length or pitch. */
  moveBy(s, dx, dy) {
    s.a.x += dx;
    s.a.y += dy;
    s.b.x += dx;
    s.b.y += dy;
  }

  applyNote(s, maxLength) {
    const note = lengthToNote(s.length, maxLength);
    s.freq = note.freq;
    s.midi = note.midi;
    s.name = note.name;
    s.hue = (note.freq * 0.7) % 360;
  }

  /**
   * Other strings whose middles sit near this one, closest first.
   * Used when a pluck makes its neighbors whisper.
   */
  neighbors(origin, radius, limit) {
    const mid = { x: (origin.a.x + origin.b.x) / 2, y: (origin.a.y + origin.b.y) / 2 };
    const found = [];
    for (const s of this.strings) {
      if (s === origin || s.draft) continue;
      const other = { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 };
      const gap = dist(mid, other);
      if (gap <= radius) found.push({ s, gap });
    }
    found.sort((a, b) => a.gap - b.gap);
    const out = [];
    for (let i = 0; i < found.length && i < limit; i++) out.push(found[i].s);
    return out;
  }

  /** Closest string within radius, or null. */
  nearest(p, radius) {
    let best = null;
    let bestD = radius;
    for (const s of this.strings) {
      const gap = distToSegment(p, s.a, s.b);
      if (gap <= bestD) {
        best = s;
        bestD = gap;
      }
    }
    return best;
  }

  /** Strings whose resting line passes within radius px of p. */
  near(p, radius) {
    const out = [];
    for (const s of this.strings) if (distToSegment(p, s.a, s.b) <= radius) out.push(s);
    return out;
  }

  /**
   * Strings crossed by the fingertip moving from→to.
   * `speed` is px/ms from the fingertip's recent frames, not this segment alone.
   */
  hits(from, to, now, speed) {
    return this.hitPaths([{ from, to }], now, speed);
  }

  /**
   * Strings crossed by any of the given fingertip paths. Each string is hit once.
   * `speed` is px/ms from the index fingertip's recent frames.
   */
  hitPaths(paths, now, speed) {
    const out = [];
    const response = velocityCurve(speed);
    const seen = new Set();
    for (const path of paths) {
      const from = path?.from;
      const to = path?.to;
      if (!from || !to) continue;
      for (const s of this.strings) {
        if (seen.has(s)) continue;
        if (now - s.pluckedAt < CONFIG.pluckCooldownMs) continue;
        if (!segmentsCross(from, to, s.a, s.b)) continue;
        const point = segmentIntersection(from, to, s.a, s.b) ?? to;
        const cross = (s.b.x - s.a.x) * (to.y - from.y) - (s.b.y - s.a.y) * (to.x - from.x);
        s.pluckedAt = now;
        s.pluckT = projectT(s.a, s.b, point);
        s.direction = Math.sign(cross) || 1;
        s.amp = response;
        s.muted = false;
        s.labelX = point.x;
        s.labelY = point.y;
        seen.add(s);
        out.push({ string: s, velocity: response, point });
      }
    }
    return out;
  }
}
