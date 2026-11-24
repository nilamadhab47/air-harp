export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a, b, t) => a + (b - a) * t;
export const lerpPt = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });

/** Snap a point onto a square grid. */
export function snapTo(p, grid) {
  return { x: Math.round(p.x / grid) * grid, y: Math.round(p.y / grid) * grid };
}

const orient = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));

/** True if segment p1→p2 strictly crosses segment q1→q2. */
export function segmentsCross(p1, p2, q1, q2) {
  const o1 = orient(p1, p2, q1);
  const o2 = orient(p1, p2, q2);
  const o3 = orient(q1, q2, p1);
  const o4 = orient(q1, q2, p2);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}

/** Parameter t (0..1) along a→b of the point closest to p. */
export function projectT(a, b, p) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  return Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
}

/** Distance from p to segment a→b. */
export function distToSegment(p, a, b) {
  return dist(p, lerpPt(a, b, projectT(a, b, p)));
}

/** Intersection point of segment p1→p2 with segment q1→q2, or null. */
export function segmentIntersection(p1, p2, q1, q2) {
  const rx = p2.x - p1.x, ry = p2.y - p1.y;
  const sx = q2.x - q1.x, sy = q2.y - q1.y;
  const den = rx * sy - ry * sx;
  if (den === 0) return null;
  const t = ((q1.x - p1.x) * sy - (q1.y - p1.y) * sx) / den;
  const u = ((q1.x - p1.x) * ry - (q1.y - p1.y) * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: p1.x + rx * t, y: p1.y + ry * t };
}
