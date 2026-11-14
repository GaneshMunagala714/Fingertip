import type { AppEvent } from "../contracts/events";
import type { AudioRoute, ConnectionState, TrackingState } from "../contracts/events";
import type { ClientCommand, CommandResult, VoiceOption } from "../contracts/commands";

export type AdapterKind = "simulation" | "live" | "idle";

export type LinkStatus =
  | { state: "idle"; reason?: string }
  | { state: "connecting" }
  | { state: "open" }
  | { state: "closed"; reason: string }
  | { state: "error"; reason: string };

export type SimulationControls = {
  sampleCaption: (mode: "partial" | "final") => void;
  sampleRecognition: (status: "partial" | "final" | "uncertain") => void;
  incoming: (remote: string) => void;
  setRoute: (route: AudioRoute) => void;
  failSpeech: () => void;
  sound: () => void;
  setTracking: (state: TrackingState) => void;
  setCall: (state: ConnectionState) => void;
};

export interface Sign2SpeakPort {
  readonly kind: AdapterKind;
  start(): void;
  stop(): void;
  subscribe(listener: (event: AppEvent) => void): () => void;
  onStatus(listener: (status: LinkStatus) => void): () => void;
  command(command: ClientCommand): Promise<CommandResult>;
  listVoices(): Promise<VoiceOption[]>;
  readonly simulation: SimulationControls | null;
}
