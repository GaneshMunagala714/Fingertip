import type {
  AppEvent,
  AudioRoute,
  Caption,
  ConnectionState,
  RecognitionResult,
  SoundEvent,
  SpeechState,
  TrackingState,
} from "../contracts/events";

export type SpeechSnapshot = {
  messageId: string;
  state: SpeechState;
  errorMessage?: string;
};

export type SessionModel = {
  call: ConnectionState;
  direction?: "inbound" | "outbound";
  remote?: string;
  sessionId?: string;
  connectedAt?: number;
  endedAt?: number;
  tracking: TrackingState;
  recognition?: RecognitionResult;
  captions: Caption[];
  speech?: SpeechSnapshot;
  route?: AudioRoute;
  sounds: SoundEvent[];
  reply?: { sourceText: string; text: string };
};

export const initialModel: SessionModel = {
  call: "idle",
  tracking: "camera_off",
  captions: [],
  sounds: [],
};

export type CameraPipeline = "off" | "running";

export function mergeTracking(
  pipeline: CameraPipeline,
  local: TrackingState,
  remote: TrackingState,
): TrackingState {
  if (pipeline === "off") return remote;
  if (remote === "recognizing" && local === "tracking") return "recognizing";
  return local;
}

function upsertCaption(captions: Caption[], next: Caption): Caption[] {
  const index = captions.findIndex((caption) => caption.id === next.id);
  if (index === -1) return [...captions, next];
  const copy = captions.slice();
  copy[index] = next;
  return copy;
}

export function reduce(state: SessionModel, event: AppEvent): SessionModel {
  switch (event.type) {
    case "call.status": {
      if (state.sessionId && event.sessionId !== state.sessionId && event.state !== "idle") {
        return reduce(
          {
            ...initialModel,
            sessionId: event.sessionId,
          },
          event,
        );
      }
      const remote = event.remote ?? state.remote;
      const direction = event.direction ?? state.direction;
      if (event.state === "connected") {
        return {
          ...state,
          call: "connected",
          sessionId: event.sessionId,
          remote,
          direction,
          connectedAt: state.connectedAt ?? event.timestampMs,
          endedAt: undefined,
        };
      }
      if (event.state === "ended" || event.state === "failed") {
        return {
          ...state,
          call: event.state,
          sessionId: event.sessionId,
          remote,
          direction,
          endedAt: event.timestampMs,
        };
      }
      if (event.state === "idle") return { ...initialModel };
      return {
        ...state,
        call: event.state,
        sessionId: event.sessionId,
        remote,
        direction,
      };
    }
    case "tracking.status":
      return { ...state, tracking: event.state };
    case "recognition.result": {
      if (
        state.recognition &&
        state.recognition.id === event.result.id &&
        event.result.revision < state.recognition.revision
      ) {
        return state;
      }
      if (state.sessionId && event.result.sessionId !== state.sessionId && state.call !== "idle") {
        return state;
      }
      return {
        ...state,
        sessionId: state.sessionId ?? event.result.sessionId,
        recognition: event.result,
      };
    }
    case "caption.update": {
      if (state.sessionId && event.caption.sessionId !== state.sessionId) return state;
      return { ...state, captions: upsertCaption(state.captions, event.caption) };
    }
    case "speech.status": {
      if (state.sessionId && event.sessionId !== state.sessionId) return state;
      if (state.speech && state.speech.messageId !== event.messageId) {
        const rank: Record<SpeechState, number> = {
          queued: 0,
          preparing: 1,
          speaking: 2,
          completed: 3,
          interrupted: 3,
          cancelled: 3,
          failed: 3,
        };
        if (rank[state.speech.state] >= 2 && rank[event.state] < 2) return state;
        if (state.speech.messageId !== event.messageId && rank[state.speech.state] < 3) return state;
      }
      return {
        ...state,
        speech: {
          messageId: event.messageId,
          state: event.state,
          errorMessage: event.errorMessage,
        },
      };
    }
    case "audio.route":
      return { ...state, route: event.route };
    case "sound.detected":
      return { ...state, sounds: [...state.sounds, event.event].slice(-4) };
    case "language.reply":
      if (state.sessionId && event.sessionId !== state.sessionId && state.call !== "idle") return state;
      return { ...state, reply: { sourceText: event.sourceText, text: event.reply } };
    default:
      return state;
  }
}
