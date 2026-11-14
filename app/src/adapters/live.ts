import { isCommandResult, type CommandResult } from "../contracts/commands";
import { isAppEvent, type AppEvent } from "../contracts/events";
import type { LinkStatus, Sign2SpeakPort } from "./port";

const ACK_MS = 8000;

/**
 * Real socket transport. It never invents call, caption, or recognition events.
 * A command stays unfinished until a command.result arrives with the same requestId.
 */
export function createLiveAdapter(url?: string): Sign2SpeakPort {
  const endpoint = url?.trim() || import.meta.env.VITE_SIGN2SPEAK_WS?.trim() || "";
  const listeners = new Set<(event: AppEvent) => void>();
  const statusListeners = new Set<(status: LinkStatus) => void>();
  const pending = new Map<string, (result: CommandResult) => void>();
  let socket: WebSocket | null = null;
  let stopped = false;

  function setStatus(status: LinkStatus) {
    for (const listener of statusListeners) listener(status);
  }

  function failPending(reason: string) {
    for (const [requestId, resolve] of pending) {
      resolve({ requestId, accepted: false, reason });
    }
    pending.clear();
  }

  return {
    kind: "live",
    simulation: null,
    start() {
      stopped = false;
      if (!endpoint) {
        setStatus({
          state: "error",
          reason: "No Sign2Speak server address is configured.",
        });
        return;
      }
      setStatus({ state: "connecting" });
      try {
        socket = new WebSocket(endpoint);
      } catch {
        setStatus({ state: "error", reason: "The server address could not be opened." });
        return;
      }
      socket.addEventListener("open", () => setStatus({ state: "open" }));
      socket.addEventListener("error", () => {
        setStatus({ state: "error", reason: "The server link failed." });
      });
      socket.addEventListener("close", () => {
        failPending("The server link closed before it answered.");
        if (!stopped) {
          setStatus({ state: "closed", reason: "The server link closed. Call state may be out of date." });
        }
      });
      socket.addEventListener("message", (event) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (isCommandResult(parsed)) {
          const resolve = pending.get(parsed.requestId);
          if (resolve) {
            pending.delete(parsed.requestId);
            resolve(parsed);
          }
          return;
        }
        if (isAppEvent(parsed)) {
          for (const listener of listeners) listener(parsed);
        }
      });
    },
    stop() {
      stopped = true;
      failPending("The server link was closed.");
      socket?.close();
      socket = null;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    listVoices() {
      return this.command({ type: "voice.list", requestId: crypto.randomUUID() }).then((result) => {
        return result.accepted && Array.isArray(result.voices) ? result.voices : [];
      });
    },
    command(command) {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return Promise.resolve({
          requestId: command.requestId,
          accepted: false,
          reason: endpoint
            ? "The server link is not open."
            : "No Sign2Speak server address is configured.",
        });
      }
      return new Promise((resolve) => {
        const timer = window.setTimeout(() => {
          pending.delete(command.requestId);
          resolve({
            requestId: command.requestId,
            accepted: false,
            reason: "The server did not answer this command.",
          });
        }, ACK_MS);
        pending.set(command.requestId, (result) => {
          window.clearTimeout(timer);
          resolve(result);
        });
        socket?.send(JSON.stringify(command));
      });
    },
  };
}
