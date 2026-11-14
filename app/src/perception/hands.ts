import type { TrackingState } from "../contracts/events";
import type { CameraPipeline } from "../state/model";

export type Landmark = { x: number; y: number; z?: number };

export type PerceptionSnapshot = {
  pipeline: CameraPipeline;
  state: TrackingState;
  hands: Landmark[][];
  error: string | null;
};

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm";
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

let snapshot: PerceptionSnapshot = {
  pipeline: "off",
  state: "camera_off",
  hands: [],
  error: null,
};

const listeners = new Set<(snapshot: PerceptionSnapshot) => void>();
const videos = new Set<HTMLVideoElement>();
let stream: MediaStream | null = null;
let landmarker: { detectForVideo: (video: HTMLVideoElement, timestamp: number) => { landmarks?: Landmark[][] } } | null = null;
let raf = 0;
let lastTs = -1;
let emptySince = 0;
let sawHand = false;
let token = 0;
let loading: Promise<void> | null = null;

function publish(next: PerceptionSnapshot) {
  const changed = next.state !== snapshot.state || next.pipeline !== snapshot.pipeline || next.error !== snapshot.error;
  snapshot = next;
  if (changed) {
    for (const listener of listeners) listener(snapshot);
  }
}

export function readPerception(): PerceptionSnapshot {
  return snapshot;
}

export function subscribePerception(listener: (snapshot: PerceptionSnapshot) => void): () => void {
  listeners.add(listener);
  listener(snapshot);
  return () => listeners.delete(listener);
}

async function ensureLandmarker() {
  if (landmarker || loading) return loading;
  loading = (async () => {
    const vision = await import("@mediapipe/tasks-vision");
    const files = await vision.FilesetResolver.forVisionTasks(WASM);
    try {
      landmarker = await vision.HandLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: MODEL, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: 2,
      });
    } catch {
      landmarker = await vision.HandLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: MODEL, delegate: "CPU" },
        runningMode: "VIDEO",
        numHands: 2,
      });
    }
  })();
  try {
    await loading;
  } catch (error) {
    loading = null;
    throw error;
  }
  return loading;
}

function loop() {
  raf = requestAnimationFrame(loop);
  const video = videos.values().next().value as HTMLVideoElement | undefined;
  if (!video || video.readyState < 2 || !landmarker) return;
  const now = performance.now();
  if (now <= lastTs) return;
  lastTs = now;
  let hands: Landmark[][] = [];
  try {
    hands = landmarker.detectForVideo(video, now).landmarks ?? [];
  } catch {
    return;
  }
  let state: TrackingState;
  if (hands.length > 0) {
    sawHand = true;
    emptySince = 0;
    state = "tracking";
  } else if (sawHand) {
    if (!emptySince) emptySince = now;
    state = now - emptySince > 900 ? "no_hands" : "lost";
    if (state === "no_hands") sawHand = false;
  } else {
    state = "no_hands";
  }
  snapshot = { pipeline: "running", state, hands, error: null };
  if (state !== readPublished) {
    readPublished = state;
    for (const listener of listeners) listener(snapshot);
  }
}

let readPublished: TrackingState = "camera_off";

function startLoop() {
  if (raf) return;
  raf = requestAnimationFrame(loop);
}

function stopPipeline() {
  cancelAnimationFrame(raf);
  raf = 0;
  lastTs = -1;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  sawHand = false;
  emptySince = 0;
  publish({ pipeline: "off", state: "camera_off", hands: [], error: snapshot.error });
  readPublished = "camera_off";
}

export async function acquireCamera(video: HTMLVideoElement): Promise<void> {
  const current = ++token;
  video.muted = true;
  video.playsInline = true;
  if (!navigator.mediaDevices?.getUserMedia) {
    const error = "This browser cannot open a camera.";
    publish({ ...snapshot, error, pipeline: "off", state: "camera_off", hands: [] });
    throw new Error(error);
  }
  try {
    if (!stream) {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      });
    }
    if (current !== token) {
      if (videos.size === 0) stopPipeline();
      return;
    }
    video.srcObject = stream;
    await video.play();
    videos.add(video);
    try {
      await ensureLandmarker();
    } catch {
      const message = "Hand tracking could not load. You can still type.";
      publish({ pipeline: "off", state: "camera_off", hands: [], error: message });
      stopPipeline();
      throw new Error(message);
    }
    if (current !== token) return;
    publish({ pipeline: "running", state: "no_hands", hands: [], error: null });
    readPublished = "no_hands";
    startLoop();
  } catch (error) {
    const denied = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
    const message = denied
      ? "Camera permission was denied. You can still type."
      : "The camera could not start. You can still type.";
    publish({ pipeline: "off", state: "camera_off", hands: [], error: message });
    throw new Error(message);
  }
}

export function releaseCamera(video: HTMLVideoElement) {
  token += 1;
  videos.delete(video);
  if (video.srcObject) video.srcObject = null;
  if (videos.size === 0) stopPipeline();
}
