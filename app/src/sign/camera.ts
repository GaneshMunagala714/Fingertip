/**
 * Landmarks in the browser (MediaPipe Tasks, WASM + models served by our own app, no CDN).
 *
 * Two trackers produce the same Frame:
 * - "lite" (?tracker=lite): Pose Landmarker lite + Hand Landmarker. No face mesh, which the sign model
 *   doesn't use. Each hand is assigned to the nearer pose wrist (15 = left, 16 = right), which is
 *   how Holistic decides left vs right, so the model's hand order stays correct.
 * - "holistic" (default): Holistic Landmarker, the layout the models were trained on. It measured
 *   faster than lite in our headless test (339 vs 537 ms per frame, CPU, no person in view); measure on the phone.
 * Pick with ?tracker=lite. The Signs lab shows frames per second and ms per frame for each.
 */
import type { Frame, P } from './segmenter'

type LM = { x: number; y: number }
type Tracker = { detect: (v: HTMLVideoElement, ts: number) => Omit<Frame, 't'>; name: string }

export const trackerName = (): 'lite' | 'holistic' =>
  new URLSearchParams(location.search).get('tracker') === 'lite' ? 'lite' : 'holistic'

let shared: Promise<Tracker> | null = null

const pts = (l?: LM[]): P[] | null => (l && l.length ? l.map((p) => [p.x, p.y] as P) : null)
const d2 = (a: LM, b: LM) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2

export function loadTracker(): Promise<Tracker> {
  if (!shared) {
    shared = (async () => {
      const mp = await import('@mediapipe/tasks-vision')
      const files = await mp.FilesetResolver.forVisionTasks('/mediapipe/wasm')
      const withFallback = async <T,>(make: (d: 'GPU' | 'CPU') => Promise<T>) => {
        try { return await make('GPU') } catch { return make('CPU') }
      }
      if (trackerName() === 'holistic') {
        const h = await withFallback((delegate) => mp.HolisticLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: '/models/holistic_landmarker.task', delegate },
          runningMode: 'VIDEO', outputFaceBlendshapes: false, outputPoseSegmentationMasks: false,
        } as any))
        return {
          name: 'holistic',
          detect: (v, ts) => {
            const r = (h as any).detectForVideo(v, ts)
            return { pose: pts(r.poseLandmarks[0]), lh: pts(r.leftHandLandmarks[0]), rh: pts(r.rightHandLandmarks[0]) }
          },
        }
      }
      const pose = await withFallback((delegate) => mp.PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: '/models/pose_landmarker_lite.task', delegate },
        runningMode: 'VIDEO', numPoses: 1,
      }))
      const hands = await withFallback((delegate) => mp.HandLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: '/models/hand_landmarker.task', delegate },
        runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.5, minTrackingConfidence: 0.5,
      }))
      return {
        name: 'lite',
        detect: (v, ts) => {
          const p = pose.detectForVideo(v, ts).landmarks[0]
          const hs = hands.detectForVideo(v, ts + 0.5).landmarks
          let lh: LM[] | undefined
          let rh: LM[] | undefined
          if (p && hs.length) {
            // Assign by nearest pose wrist (person's left = 15, right = 16), like Holistic does.
            const scored = hs.map((h) => ({ h, toL: d2(h[0], p[15]), toR: d2(h[0], p[16]) }))
            if (scored.length === 1) {
              const s = scored[0]
              if (s.toL < s.toR) lh = s.h
              else rh = s.h
            } else {
              const [a, b] = scored
              if (a.toL + b.toR <= a.toR + b.toL) { lh = a.h; rh = b.h } else { lh = b.h; rh = a.h }
            }
          }
          return { pose: pts(p), lh: pts(lh), rh: pts(rh) }
        },
      }
    })()
    shared.catch(() => { shared = null })
  }
  return shared
}

/** Runs the tracker on every new video frame. Returns a stop function. */
export function watch(video: HTMLVideoElement, onFrame: (f: Frame) => void, onFps?: (fps: number, msPerFrame: number) => void): () => void {
  let stop = false
  let last = -1
  let n = 0
  let busy = 0
  let t0 = performance.now()
  loadTracker().then((tr) => {
    const tick = () => {
      if (stop) return
      if (video.readyState >= 2 && video.currentTime !== last) {
        last = video.currentTime
        const t = performance.now()
        try {
          const f = tr.detect(video, t)
          busy += performance.now() - t
          onFrame({ ...f, t })
          n++
          if (t - t0 > 2000) { onFps?.((n * 1000) / (t - t0), busy / n); n = 0; busy = 0; t0 = t }
        } catch { /* a bad frame is skipped */ }
      }
      const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => void }
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(tick)
      else requestAnimationFrame(tick)
    }
    tick()
  }).catch(() => { /* recognition unavailable: typing still works */ })
  return () => { stop = true }
}
