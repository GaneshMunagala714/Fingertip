import type { AppEvent } from "../contracts/events";
import type { ClientCommand, CommandResult, VoiceOption } from "../contracts/commands";
import type { LinkStatus, Sign2SpeakPort, SimulationControls } from "./port";

const SAMPLE_VOICES: VoiceOption[] = [
  {
    id: "warm",
    label: "Warm",
    description: "Sample voice in this simulation. It is not the call.",
  },
  {
    id: "clear",
    label: "Clear",
    description: "Sample voice in this simulation. It is not the call.",
  },
];

function reject(requestId: string, reason: string): CommandResult {
  return { requestId, accepted: false, reason };
}

const SAMPLE_REPLIES: Record<string, string> = {
  "explain again": "Could you explain that again?",
  "say again": "Could you say that again?",
  "that part": "Please explain that part.",
  "five minutes": "I'll be there in five minutes.",
  "be there": "I'll be there.",
  five: "I'll be there in five minutes.",
};

/** Turns a word or two into one spoken sentence. Sample copy only. */
export function composeReply(source: string): string {
  const key = source.trim().toLowerCase().replace(/[.?!,]/g, "");
  if (SAMPLE_REPLIES[key]) return SAMPLE_REPLIES[key];
  const words = key.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length > 8) {
    const trimmed = source.trim();
    return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
  }
  const phrase = words.join(" ");
  return `I wanted to say ${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}.`;
}

/**
 * Local sample transport. It never places a telephone call and never
 * recognizes sign language. Every phrase it emits is sample copy.
 */
export function createSimulationAdapter(): Sign2SpeakPort {
  const listeners = new Set<(event: AppEvent) => void>();
  const statusListeners = new Set<(status: LinkStatus) => void>();
  let sessionId = "";
  let messageId = "";
  let timers: number[] = [];
  let revision = 0;
  let stopped = false;

  function emit(event: AppEvent) {
    if (stopped) return;
    for (const listener of listeners) listener(event);
  }

  function later(ms: number, run: () => void) {
    const id = window.setTimeout(run, ms);
    timers.push(id);
  }

  function speakTimeline(id: string, fail = false) {
    emit({
      type: "speech.status",
      sessionId,
      messageId: id,
      state: "preparing",
      timestampMs: Date.now(),
    });
    later(500, () => {
      emit({
        type: "speech.status",
        sessionId,
        messageId: id,
        state: fail ? "failed" : "speaking",
        timestampMs: Date.now(),
        errorMessage: fail ? "The sample voice service rejected playback." : undefined,
      });
    });
    if (fail) return;
    later(2200, () => {
      emit({
        type: "speech.status",
        sessionId,
        messageId: id,
        state: "completed",
        timestampMs: Date.now(),
      });
    });
  }

  const simulation: SimulationControls = {
    sampleCaption(mode) {
      if (!sessionId) return;
      const captionId = "sample-caption";
      if (mode === "partial") {
        emit({
          type: "caption.update",
          caption: {
            id: captionId,
            sessionId,
            speakerId: "Sample voice",
            text: "Can you hear",
            isFinal: false,
            startMs: Date.now(),
          },
        });
        return;
      }
      emit({
        type: "caption.update",
        caption: {
          id: captionId,
          sessionId,
          speakerId: "Sample voice",
          text: "Can you hear me okay?",
          isFinal: true,
          startMs: Date.now() - 800,
          endMs: Date.now(),
        },
      });
    },
    sampleRecognition(status) {
      if (!sessionId) sessionId = "sim-local";
      revision += 1;
      const id = "sample-recognition";
      if (status === "partial") {
        emit({
          type: "recognition.result",
          result: {
            id,
            sessionId,
            revision,
            text: "five",
            status: "partial",
            timestampMs: Date.now(),
          },
        });
        return;
      }
      if (status === "uncertain") {
        emit({
          type: "tracking.status",
          state: "recognizing",
          timestampMs: Date.now(),
        });
        emit({
          type: "recognition.result",
          result: {
            id,
            sessionId,
            revision,
            text: "explain again",
            glosses: ["EXPLAIN", "AGAIN"],
            status: "uncertain",
            alternatives: [
              { id: "alt-1", text: "explain again" },
              { id: "alt-2", text: "say again" },
              { id: "alt-3", text: "that part" },
            ],
            timestampMs: Date.now(),
          },
        });
        return;
      }
      emit({
        type: "recognition.result",
        result: {
          id,
          sessionId,
          revision,
          text: "five minutes",
          glosses: ["ME", "ARRIVE", "FIVE", "MINUTE"],
          status: "final",
          timestampMs: Date.now(),
        },
      });
    },
    incoming(remote) {
      sessionId = crypto.randomUUID();
      emit({
        type: "call.status",
        sessionId,
        state: "ringing",
        timestampMs: Date.now(),
        direction: "inbound",
        remote,
      });
    },
    setRoute(route) {
      emit({ type: "audio.route", route });
    },
    failSpeech() {
      const id = messageId || crypto.randomUUID();
      messageId = id;
      speakTimeline(id, true);
    },
    sound() {
      emit({
        type: "sound.detected",
        event: { id: crypto.randomUUID(), label: "doorbell", timestampMs: Date.now() },
      });
    },
    setTracking(state) {
      emit({ type: "tracking.status", state, timestampMs: Date.now() });
    },
    setCall(state) {
      if (!sessionId) sessionId = crypto.randomUUID();
      emit({
        type: "call.status",
        sessionId,
        state,
        timestampMs: Date.now(),
        direction: "outbound",
        remote: "+15555550100",
      });
    },
  };

  return {
    kind: "simulation",
    simulation,
    start() {
      stopped = false;
      for (const listener of statusListeners) {
        listener({ state: "open" });
      }
    },
    stop() {
      stopped = true;
      for (const id of timers) window.clearTimeout(id);
      timers = [];
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    async listVoices() {
      return SAMPLE_VOICES;
    },
    async command(command: ClientCommand): Promise<CommandResult> {
      switch (command.type) {
        case "voice.list":
          return { requestId: command.requestId, accepted: true };
        case "call.dial": {
          sessionId = crypto.randomUUID();
          const remote = command.number;
          emit({
            type: "call.status",
            sessionId,
            state: "connecting",
            timestampMs: Date.now(),
            direction: "outbound",
            remote,
          });
          later(700, () => {
            emit({
              type: "call.status",
              sessionId,
              state: "ringing",
              timestampMs: Date.now(),
              direction: "outbound",
              remote,
            });
          });
          later(1700, () => {
            emit({
              type: "call.status",
              sessionId,
              state: "connected",
              timestampMs: Date.now(),
              direction: "outbound",
              remote,
            });
            emit({
              type: "audio.route",
              route: { kind: "pstn", state: "active", deviceLabel: "Simulated line" },
            });
            emit({
              type: "caption.update",
              caption: {
                id: "sample-caption",
                sessionId,
                speakerId: "Sample voice",
                text: "Can you hear",
                isFinal: false,
                startMs: Date.now(),
              },
            });
          });
          later(2500, () => {
            emit({
              type: "caption.update",
              caption: {
                id: "sample-caption",
                sessionId,
                speakerId: "Sample voice",
                text: "Can you hear me okay?",
                isFinal: true,
                startMs: Date.now() - 600,
                endMs: Date.now(),
              },
            });
          });
          return { requestId: command.requestId, accepted: true };
        }
        case "call.answer":
          if (!sessionId || command.sessionId !== sessionId) {
            return reject(command.requestId, "There is no ringing sample call to answer.");
          }
          emit({
            type: "call.status",
            sessionId,
            state: "connected",
            timestampMs: Date.now(),
            direction: "inbound",
          });
          return { requestId: command.requestId, accepted: true };
        case "call.hangup":
          if (!sessionId || command.sessionId !== sessionId) {
            return reject(command.requestId, "There is no sample call to end.");
          }
          if (messageId) {
            emit({
              type: "speech.status",
              sessionId,
              messageId,
              state: "interrupted",
              timestampMs: Date.now(),
            });
          }
          emit({
            type: "call.status",
            sessionId,
            state: "ended",
            timestampMs: Date.now(),
          });
          return { requestId: command.requestId, accepted: true };
        case "language.expand": {
          const reply = composeReply(command.text);
          if (!reply) return reject(command.requestId, "There is nothing to turn into a sentence.");
          if (!sessionId) sessionId = command.sessionId;
          if (command.sessionId !== sessionId) {
            return reject(command.requestId, "That reply belongs to a different call.");
          }
          emit({
            type: "language.reply",
            requestId: command.requestId,
            sessionId,
            sourceText: command.text.trim(),
            reply,
            timestampMs: Date.now(),
          });
          return { requestId: command.requestId, accepted: true };
        }
        case "speech.speak": {
          const text = command.text.trim();
          if (!text) return reject(command.requestId, "There is no phrase to speak.");
          if (!sessionId) sessionId = command.sessionId;
          if (command.sessionId !== sessionId) {
            return reject(command.requestId, "That phrase belongs to a different call.");
          }
          messageId = crypto.randomUUID();
          emit({
            type: "speech.status",
            sessionId,
            messageId,
            state: "queued",
            timestampMs: Date.now(),
          });
          speakTimeline(messageId, false);
          return { requestId: command.requestId, accepted: true, messageId };
        }
        case "speech.cancel":
          if (command.messageId !== messageId) {
            return reject(command.requestId, "That phrase is not in the sample queue.");
          }
          emit({
            type: "speech.status",
            sessionId,
            messageId: command.messageId,
            state: "cancelled",
            timestampMs: Date.now(),
          });
          return { requestId: command.requestId, accepted: true, messageId: command.messageId };
      }
    },
  };
}
