import type { ClientCommand, CommandResult } from "../contracts/commands";
import type { LinkStatus, Sign2SpeakPort } from "./port";

const REASON = "Sign2Speak is not connected to a server.";

/** Silent transport. It emits nothing and accepts nothing. */
export function createIdleAdapter(): Sign2SpeakPort {
  const statusListeners = new Set<(status: LinkStatus) => void>();
  return {
    kind: "idle",
    simulation: null,
    start() {
      for (const listener of statusListeners) listener({ state: "idle", reason: REASON });
    },
    stop() {},
    subscribe() {
      return () => undefined;
    },
    onStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    async listVoices() {
      return [];
    },
    async command(command: ClientCommand): Promise<CommandResult> {
      return { requestId: command.requestId, accepted: false, reason: REASON };
    },
  };
}
