import type { ConnectionState, SpeechState, TrackingState } from "../contracts/events";

export function connectionLabel(state: ConnectionState): string {
  switch (state) {
    case "idle":
      return "No call";
    case "connecting":
      return "Calling";
    case "ringing":
      return "Ringing";
    case "connected":
      return "In call";
    case "reconnecting":
      return "Reconnecting";
    case "ended":
      return "Call ended";
    case "failed":
      return "Call failed";
  }
}

export function trackingLabel(state: TrackingState): string {
  switch (state) {
    case "camera_off":
      return "Camera off";
    case "no_hands":
      return "No hands in frame";
    case "tracking":
      return "Hands visible";
    case "recognizing":
      return "Checking the sign";
    case "lost":
      return "Hands left the frame";
  }
}

export function speechLabel(state: SpeechState): string {
  switch (state) {
    case "queued":
      return "Queued";
    case "preparing":
      return "Preparing voice";
    case "speaking":
      return "Speaking";
    case "completed":
      return "Finished speaking";
    case "interrupted":
      return "Interrupted";
    case "cancelled":
      return "Canceled";
    case "failed":
      return "Speaking failed";
  }
}

export function speakerLabel(id?: string): string {
  if (!id) return "Other person";
  if (/^[0-9a-f-]{20,}$/i.test(id)) return "Other person";
  return id;
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function pillLabel(tracking: TrackingState, review: boolean, speaking: boolean): string {
  if (speaking) return "Speaking";
  if (review) return "Review";
  if (tracking === "recognizing") return "Checking";
  if (tracking === "tracking") return "Hands visible";
  if (tracking === "lost") return "Hands lost";
  if (tracking === "no_hands") return "No hands";
  return "Camera off";
}
