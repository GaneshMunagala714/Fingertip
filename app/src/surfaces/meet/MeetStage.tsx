import { useEffect, useRef, useState } from "react";
import { MeetOverlay } from "./MeetOverlay";
import { SimulationDeck } from "../../dev/SimulationDeck";
import { useSession } from "../../state/SessionProvider";

export function MeetStage({ onBack }: { onBack: () => void }) {
  const youRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<"speaker" | "gallery">("speaker");
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [deck, setDeck] = useState(false);
  const { kind } = useSession();

  useEffect(() => {
    const element = youRef.current;
    if (!element) return;
    const update = () => setAnchor(element.getBoundingClientRect());
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [layout]);

  return (
    <div className="stage">
      <div className="stage-banner">
        <p>Preview of the layer only. On a real call, Google Meet stays open and this sits on top of it.{kind === "simulation" ? " Sample data." : ""}</p>
        <div>
          <button type="button" onClick={() => setLayout((item) => (item === "speaker" ? "gallery" : "speaker"))}>
            {layout === "speaker" ? "Gallery view" : "Speaker view"}
          </button>
          {kind === "simulation" ? (
            <button type="button" onClick={() => setDeck(true)}>Sample data</button>
          ) : null}
          <button type="button" onClick={onBack}>Back</button>
        </div>
      </div>
      <div className="stage-grid" data-layout={layout}>
        <div className="tile tile-main" aria-hidden="true">
          <span>Participant</span>
        </div>
        {layout === "gallery" ? (
          <>
            <div className="tile" aria-hidden="true"><span>Participant</span></div>
            <div className="tile" aria-hidden="true"><span>Participant</span></div>
          </>
        ) : null}
        <div className="tile tile-you" ref={youRef} data-self="true">
          <span>You</span>
        </div>
      </div>
      <div className="stage-bar" aria-hidden="true">
        <span /><span /><span /><span />
      </div>
      <MeetOverlay anchor={anchor} offsetTop={56} />
      <SimulationDeck open={deck} onClose={() => setDeck(false)} />
    </div>
  );
}
