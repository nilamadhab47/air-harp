import { CONFIG } from "./config.js";

const MIME_TYPES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

/**
 * First supported WebM type, VP9 preferred. Empty when this browser cannot record WebM.
 * @param {(type: string) => boolean} isSupported
 */
export function chooseMime(isSupported) {
  return MIME_TYPES.find((type) => isSupported(type)) ?? "";
}

/** @param {number} [now] */
export function recordFilename(now = Date.now()) {
  return `air-harp-${now}.webm`;
}

function makeRecorder(stream, mime) {
  const rated = {
    mimeType: mime,
    videoBitsPerSecond: CONFIG.recordVideoBits,
    audioBitsPerSecond: CONFIG.recordAudioBits,
  };
  try {
    return new MediaRecorder(stream, rated);
  } catch {
    return new MediaRecorder(stream, { mimeType: mime });
  }
}

/** Canvas video plus the synth's media stream. Chunks stay in memory until stop. */
export class Recorder {
  constructor() {
    this.recorder = null;
    this.chunks = [];
    this.video = null;
    this.mime = "";
    this.startedAt = 0;
    /** @type {((blob: Blob) => void) | null} */
    this.onstop = null;
  }

  get active() {
    return this.recorder?.state === "recording";
  }

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {MediaStream} audioStream
   * @param {string} mime
   */
  start(canvas, audioStream, mime) {
    const video = canvas.captureStream(CONFIG.recordFps);
    const mixed = new MediaStream([...video.getVideoTracks(), ...audioStream.getAudioTracks()]);
    this.chunks = [];
    this.video = video;
    this.mime = mime;
    this.recorder = makeRecorder(mixed, mime);
    this.startedAt = performance.now();
    this.recorder.ondataavailable = (ev) => {
      if (ev.data?.size) this.chunks.push(ev.data);
    };
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      const blob = new Blob(this.chunks, { type: this.mime });
      this.chunks = [];
      this.recorder = null;
      for (const track of video.getTracks()) track.stop();
      this.video = null;
      this.onstop?.(blob);
    };
    this.recorder.onstop = finish;
    this.recorder.onerror = () => {
      if (this.recorder?.state === "recording") this.recorder.stop();
      else finish();
    };
    this.recorder.start();
  }

  stop() {
    if (this.recorder?.state === "recording") this.recorder.stop();
  }

  /** Drop a recorder that never produced a clip. */
  cancel() {
    const rec = this.recorder;
    this.recorder = null;
    if (rec) rec.onstop = null;
    if (rec?.state === "recording") rec.stop();
    if (this.video) {
      for (const track of this.video.getTracks()) track.stop();
      this.video = null;
    }
    this.chunks = [];
  }
}

/** @param {Blob} blob @param {string} name */
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
