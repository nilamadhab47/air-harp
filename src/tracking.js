import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import { CONFIG } from "./config.js";

export async function startCamera(video) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: CONFIG.camera.width, height: CONFIG.camera.height, facingMode: "user" },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  if (!video.videoWidth || !video.videoHeight) {
    await new Promise((resolve, reject) => {
      const onData = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        video.removeEventListener("loadeddata", onData);
        reject(new Error("Camera produced no frames"));
      }, CONFIG.cameraTimeoutMs);
      video.addEventListener("loadeddata", onData, { once: true });
    });
  }
  if (!video.videoWidth || !video.videoHeight) throw new Error("Camera produced no frames");
  return stream;
}

export async function createHandTracker() {
  const vision = await FilesetResolver.forVisionTasks(CONFIG.wasmPath);
  const make = (delegate) =>
    HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: CONFIG.modelPath, delegate },
      runningMode: "VIDEO",
      numHands: CONFIG.numHands,
    });
  try {
    return await make("GPU");
  } catch (e) {
    console.warn("GPU delegate failed, falling back to CPU", e);
    return make("CPU");
  }
}

/**
 * Convert normalized landmarks to canvas pixels (mirrored if configured).
 * `z` is depth in the same pixel scale as x. Smaller z is closer to the camera. It is not mirrored.
 */
export function toPixels(landmarks, w, h) {
  return landmarks.map((p) => ({
    x: (CONFIG.mirror ? 1 - p.x : p.x) * w,
    y: p.y * h,
    z: (p.z || 0) * w,
  }));
}
