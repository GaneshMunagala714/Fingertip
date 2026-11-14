import { useSession } from "../state/SessionProvider";

export function SimulationDeck({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { simulation, model } = useSession();
  if (!open || !simulation) return null;
  const inCall = Boolean(model.sessionId);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet deck" role="dialog" aria-labelledby="sample-title" onClick={(event) => event.stopPropagation()}>
        <h2 id="sample-title">Sample data</h2>
        <p className="hint">These events are scripted. They are not a live call, and they are not recognized ASL.</p>
        <div className="deck-grid">
          <button type="button" disabled={!inCall} onClick={() => simulation.sampleCaption("partial")}>Partial caption</button>
          <button type="button" disabled={!inCall} onClick={() => simulation.sampleCaption("final")}>Final caption</button>
          <button type="button" onClick={() => simulation.sampleRecognition("partial")}>Partial phrase</button>
          <button type="button" onClick={() => simulation.sampleRecognition("uncertain")}>Uncertain phrase</button>
          <button type="button" onClick={() => simulation.sampleRecognition("final")}>Final phrase</button>
          <button type="button" onClick={() => simulation.failSpeech()}>Failed speech</button>
          <button type="button" onClick={() => simulation.sound()}>Nearby sound</button>
          <button type="button" onClick={() => simulation.incoming("+15555550199")}>Incoming sample</button>
          <button type="button" onClick={() => simulation.setCall("reconnecting")}>Reconnecting</button>
          <button type="button" onClick={() => simulation.setCall("failed")}>Failed call</button>
          <button
            type="button"
            onClick={() =>
              simulation.setRoute({
                kind: "virtual_microphone",
                state: "error",
                errorMessage: "No virtual microphone is available on this computer.",
              })
            }
          >
            Audio route error
          </button>
        </div>
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
