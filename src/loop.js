import { CONFIG } from "./config.js";

/**
 * Turn the latest hits into one repeating bar.
 * The tempo is the median gap between those hits. Odd 16ths are delayed so the bar swings.
 * @param {{t:number, sound:string}[]} events
 * @returns {{barMs:number, beat:number, events:object[]} | null}
 */
export function stampLoop(events, now) {
  const recent = [];
  for (const event of events) {
    if (event.t <= now && now - event.t <= CONFIG.loopCaptureMs) recent.push(event);
  }
  if (recent.length < CONFIG.loopMinEvents) return null;

  const times = recent.map((event) => event.t).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1];
    if (gap >= CONFIG.loopGapMinMs && gap <= CONFIG.loopGapMaxMs) gaps.push(gap);
  }
  const beat = clamp(
    median(gaps.length ? gaps : [CONFIG.loopDefaultBeatMs]),
    CONFIG.loopBeatMinMs,
    CONFIG.loopBeatMaxMs,
  );
  const barMs = beat * CONFIG.loopBeats;
  const end = times[times.length - 1];
  const kept = recent.filter((event) => event.t >= end - barMs);
  if (kept.length < CONFIG.loopMinEvents) return null;
  const origin = Math.min(...kept.map((event) => event.t));
  const stepMs = barMs / CONFIG.loopSteps;
  const seen = new Set();
  const out = [];
  for (const event of kept) {
    let step = Math.round((event.t - origin) / stepMs);
    if (step < 0) step = 0;
    if (step >= CONFIG.loopSteps) step = CONFIG.loopSteps - 1;
    if (seen.has(`${step}:${event.sound}`)) continue;
    seen.add(`${step}:${event.sound}`);
    let at = step * stepMs;
    if (step % 2 === 1) at += stepMs * CONFIG.loopSwing;
    out.push({ ...event, at, step });
  }
  out.sort((a, b) => a.at - b.at);
  return { barMs, beat, events: out };
}

/** Events whose time was crossed since the previous playhead, including the wrap. */
export function dueEvents(loop, pos, prev) {
  const out = [];
  for (const event of loop.events) {
    const crossed = prev <= pos
      ? event.at >= prev && event.at < pos
      : event.at >= prev || event.at < pos;
    if (crossed) out.push(event);
  }
  return out;
}

/** Events that will speak within `windowMs`, wrapping around the bar. */
export function upcoming(loop, pos, windowMs) {
  const out = [];
  for (const event of loop.events) {
    let ahead = event.at - pos;
    if (ahead < 0) ahead += loop.barMs;
    if (ahead <= windowMs) out.push(event);
  }
  return out;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}
