import { CONFIG } from "./config.js";
import { midiToName } from "./audio.js";

/** Short public-domain tunes. Steps are semitones above the root. */
export const SONGS = [
  { id: "off", name: "Free" },
  {
    id: "lamb",
    name: "Little Lamb",
    steps: [4, 2, 0, 2, 4, 4, 4, 2, 2, 2, 4, 7, 7, 4, 2, 2, 4, 2, 0],
    beats: [1, 1, 1, 1, 1, 1, 2, 1, 1, 2, 1, 1, 2, 1, 1, 1, 1, 1, 2],
  },
  {
    id: "twinkle",
    name: "Twinkle",
    steps: [0, 0, 7, 7, 9, 9, 7, 5, 5, 4, 4, 2, 2, 0],
    beats: [1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 2],
  },
  {
    id: "joy",
    name: "Ode to Joy",
    steps: [4, 4, 5, 7, 7, 5, 4, 2, 0, 0, 2, 4, 4, 2, 2],
    beats: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2],
  },
];

/** The tune selected in Tune, or Free. */
export function activeSong() {
  return SONGS.find((song) => song.id === CONFIG.songId) ?? SONGS[0];
}

/** One note of a tune, transposed to the current root and sitting in a singing octave. */
export function melodyNote(song, index) {
  const at = ((index % song.steps.length) + song.steps.length) % song.steps.length;
  const midi = CONFIG.baseMidi + 12 + CONFIG.root + song.steps[at];
  const word = song.words?.[at];
  return {
    midi,
    name: midiToName(midi),
    freq: 440 * Math.pow(2, (midi - 69) / 12),
    beat: song.beats[at],
    swar: word?.swar || "",
    syllables: word?.syllables || null,
    mark: word?.mark ?? -1,
    line: word?.line || 0,
    lines: word?.lines || 0,
  };
}

/**
 * Lay the tune across the strings from left to right.
 * One string keeps its place in the tune. Free mode changes nothing.
 * @param {object[]} strings
 * @returns {boolean}
 */
export function laySong(strings) {
  const song = activeSong();
  if (!song.steps) return false;
  const ordered = strings.filter((s) => !s.draft).sort((a, b) => (a.a.x + a.b.x) - (b.a.x + b.b.x));
  if (ordered.length === 1) {
    const index = ordered[0].songStep ?? 0;
    paint(ordered[0], melodyNote(song, index), index);
    return true;
  }
  ordered.forEach((s, i) => {
    s.sung = null;
    const index = i % song.steps.length;
    paint(s, melodyNote(song, index), index);
  });
  return true;
}

/**
 * The whole tune, timed from `now`. One pluck plays this; the strings only light up.
 * @returns {{notes: object[], until: number} | null}
 */
export function songPhrase(now) {
  const song = activeSong();
  if (!song.steps) return null;
  const notes = [];
  let delay = 0;
  for (let i = 0; i < song.steps.length; i++) {
    const note = melodyNote(song, i);
    notes.push({ ...note, at: now + delay, index: i });
    delay += note.beat * CONFIG.songBeatMs;
  }
  return { notes, until: now + delay };
}

function paint(string, note, index) {
  const sung = string.sung;
  string.freq = note.freq;
  string.midi = note.midi;
  string.name = note.name;
  string.hue = (note.freq * 0.7) % 360;
  string.songStep = index;
  string.sung = sung || null;
}
