import { createIdleAdapter } from "./idle";
import { createLiveAdapter } from "./live";
import type { AdapterKind, Sign2SpeakPort } from "./port";
import { createSimulationAdapter } from "./simulation";

export function createPort(kind: AdapterKind, liveUrl?: string): Sign2SpeakPort {
  if (kind === "simulation") return createSimulationAdapter();
  if (kind === "live") return createLiveAdapter(liveUrl);
  return createIdleAdapter();
}
