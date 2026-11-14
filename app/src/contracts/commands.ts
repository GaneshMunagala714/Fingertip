export type ClientCommand =
  | {
      type: "call.dial";
      requestId: string;
      number: string;
    }
  | {
      type: "call.answer";
      requestId: string;
      sessionId: string;
    }
  | {
      type: "call.hangup";
      requestId: string;
      sessionId: string;
    }
  | {
      type: "speech.speak";
      requestId: string;
      sessionId: string;
      text: string;
      voiceId?: string;
    }
  | {
      type: "speech.cancel";
      requestId: string;
      sessionId: string;
      messageId: string;
    }
  | {
      type: "voice.list";
      requestId: string;
    }
  | {
      type: "language.expand";
      requestId: string;
      sessionId: string;
      text: string;
    };

export type CommandResult = {
  requestId: string;
  accepted: boolean;
  reason?: string;
  messageId?: string;
  voices?: VoiceOption[];
};

export type VoiceOption = {
  id: string;
  label: string;
  description?: string;
};

export function isCommandResult(value: unknown): value is CommandResult {
  if (!value || typeof value !== "object") return false;
  const message = value as { type?: string; requestId?: string; accepted?: boolean };
  return message.type === "command.result" &&
    typeof message.requestId === "string" &&
    typeof message.accepted === "boolean";
}
