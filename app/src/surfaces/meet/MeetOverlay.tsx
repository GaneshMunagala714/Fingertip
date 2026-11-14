import { useRef, useState } from "react";
import { useSession } from "../../state/SessionProvider";
import { AudioDeviceStatus } from "../../components/status";
import { PhrasePanel } from "../../components/phrase";
import { pillLabel, speakerLabel } from "../../components/copy";

export function MeetOverlay({
  anchor,
  offsetTop = 16,
}: {
  anchor: DOMRect | null;
  offsetTop?: number;
}) {
  const session = useSession();
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [hidden, setHidden] = useState(false);
  const [menu, setMenu] = useState(false);
  const offset = useRef({ dx: 0, dy: 0 });
  const speaking = session.model.speech?.state === "speaking" || session.model.speech?.state === "preparing";
  const review = session.phase === "uncertain";
  const awake = session.phase !== "empty" || Boolean(session.model.speech) || session.model.captions.length > 0 || Boolean(session.rejection) || Boolean(session.replyText);
  const cardOpen = awake || menu;
  const latest = [...session.model.captions].reverse().find((caption) => caption.isFinal) ?? session.model.captions.at(-1);

  if (hidden) {
    return (
      <button type="button" className="pill overlay-show" onClick={() => setHidden(false)}>
        Sign2Speak
      </button>
    );
  }

  const width = Math.min(360, window.innerWidth - 32);
  let left = window.innerWidth - width - 16;
  let bottom = 100;
  if (!drag && anchor && anchor.width > 220 && anchor.height > 160) {
    left = Math.min(Math.max(16, anchor.left + 12), window.innerWidth - width - 16);
    bottom = Math.max(92, window.innerHeight - anchor.bottom + 12);
  }

  return (
    <div className="overlay-root">
      <button
        type="button"
        className="pill"
        style={{ top: offsetTop }}
        aria-expanded={menu}
        onClick={() => setMenu((open) => !open)}
      >
        <span className="dot" data-state={speaking ? "speaking" : review ? "uncertain" : session.model.tracking} />
        <span>Sign2Speak</span>
        <span className="pill-state">{pillLabel(session.model.tracking, review, speaking)}</span>
      </button>
      {menu ? (
        <div className="pill-menu" style={{ top: offsetTop + 44 }}>
          <button type="button" onClick={() => setHidden(true)}>Hide overlay</button>
        </div>
      ) : null}
      {cardOpen ? (
        <article
          className="overlay-card"
          style={drag ? { left: drag.x, top: drag.y, width } : { left, bottom, width }}
        >
          <header
            className="overlay-handle"
            onPointerDown={(event) => {
              const rect = (event.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
              offset.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
              setDrag({
                x: Math.max(8, event.clientX - offset.current.dx),
                y: Math.max(8, event.clientY - offset.current.dy),
              });
            }}
          >
            <strong>You</strong>
            <span>Your screen only. The call stays in Google Meet.</span>
          </header>
          {latest ? (
            <p className="overlay-caption" data-partial={!latest.isFinal}>
              <span>{speakerLabel(latest.speakerId)}</span>
              {latest.text}
            </p>
          ) : null}
          <PhrasePanel compact />
          <AudioDeviceStatus surface="meet" />
          {session.rejection ? <p className="inline-error">{session.rejection}</p> : null}
        </article>
      ) : null}
    </div>
  );
}
