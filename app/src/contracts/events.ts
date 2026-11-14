export type ConnectionState =
  | "idle"
  | "connecting"
  | "ringing"
  | "connected"
  | "reconnecting"
  | "ended"
  | "failed";

export type TrackingState =
  | "camera_off"
  | "no_hands"
  | "tracking"
  | "recognizing"
  | "lost";

export type RecognitionResult = {
  id: string;
  sessionId: string;
  revision: number;
  text: string;
  glosses?: string[];
  status: "partial" | "final" | "uncertain";
  confidence?: number;
  alternatives?: { id: string; text: string }[];
  timestampMs: number;
};

export type Caption = {
  id: string;
  sessionId: string;
  speakerId?: string;
  text: string;
  isFinal: boolean;
  startMs: number;
  endMs?: number;
};

export type SpeechState =
  | "queued"
  | "preparing"
  | "speaking"
  | "completed"
  | "interrupted"
  | "cancelled"
  | "failed";

export type AudioRoute = {
  kind: "pstn" | "virtual_microphone";
  state: "unavailable" | "ready" | "active" | "error";
  deviceLabel?: string;
  errorMessage?: string;
};

export type SoundEvent = {
  id: string;
  label: string;
  timestampMs: number;
  confidence?: number;
};

export type AppEvent =
  | {
      type: "call.status";
      sessionId: string;
      state: ConnectionState;
      timestampMs: number;
      direction?: "inbound" | "outbound";
      remote?: string;
    }
  | {
      type: "tracking.status";
      state: TrackingState;
      timestampMs: number;
    }
  | {
      type: "recognition.result";
      result: RecognitionResult;
    }
  | {
      type: "language.reply";
      requestId: string;
      sessionId: string;
      sourceText: string;
      reply: string;
      timestampMs: number;
    }
  | {
      type: "caption.update";
      caption: Caption;
    }
  | {
      type: "speech.status";
      sessionId: string;
      messageId: string;
      state: SpeechState;
      timestampMs: number;
      errorMessage?: string;
    }
  | {
      type: "audio.route";
      route: AudioRoute;
    }
  | {
      type: "sound.detected";
      event: SoundEvent;
    };

const CONNECTION: readonly ConnectionState[] = [
  "idle",
  "connecting",
  "ringing",
  "connected",
  "reconnecting",
  "ended",
  "failed",
];

const TRACKING: readonly TrackingState[] = [
  "camera_off",
  "no_hands",
  "tracking",
  "recognizing",
  "lost",
];

const SPEECH: readonly SpeechState[] = [
  "queued",
  "preparing",
  "speaking",
  "completed",
  "interrupted",
  "cancelled",
  "failed",
];

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

export function isAppEvent(value: unknown): value is AppEvent {
  const message = record(value);
  if (!message || typeof message.type !== "string") return false;
  switch (message.type) {
    case "call.status":
      return typeof message.sessionId === "string" &&
        typeof message.timestampMs === "number" &&
        CONNECTION.includes(message.state as ConnectionState);
    case "tracking.status":
      return typeof message.timestampMs === "number" &&
        TRACKING.includes(message.state as TrackingState);
    case "recognition.result": {
      const result = record(message.result);
      return !!result &&
        typeof result.id === "string" &&
        typeof result.sessionId === "string" &&
        typeof result.revision === "number" &&
        typeof result.text === "string" &&
        (result.status === "partial" || result.status === "final" || result.status === "uncertain") &&
        typeof result.timestampMs === "number";
    }
    case "language.reply":
      return typeof message.requestId === "string" &&
        typeof message.sessionId === "string" &&
        typeof message.sourceText === "string" &&
        typeof message.reply === "string" &&
        typeof message.timestampMs === "number";
    case "caption.update": {
      const caption = record(message.caption);
      return !!caption &&
        typeof caption.id === "string" &&
        typeof caption.sessionId === "string" &&
        typeof caption.text === "string" &&
        typeof caption.isFinal === "boolean" &&
        typeof caption.startMs === "number";
    }
    case "speech.status":
      return typeof message.sessionId === "string" &&
        typeof message.messageId === "string" &&
        typeof message.timestampMs === "number" &&
        SPEECH.includes(message.state as SpeechState);
    case "audio.route": {
      const route = record(message.route);
      return !!route &&
        (route.kind === "pstn" || route.kind === "virtual_microphone") &&
        (route.state === "unavailable" || route.state === "ready" || route.state === "active" || route.state === "error");
    }
    case "sound.detected": {
      const event = record(message.event);
      return !!event && typeof event.id === "string" && typeof event.label === "string" && typeof event.timestampMs === "number";
    }
    default:
      return false;
  }
}
