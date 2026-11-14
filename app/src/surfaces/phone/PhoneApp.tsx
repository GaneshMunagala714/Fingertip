import { useEffect, useRef, useState } from "react";
import { useSession } from "../../state/SessionProvider";
import { AudioDeviceStatus, CallTimer, CaptionStream, ConnectionBadge, ErrorBanner } from "../../components/status";
import { CameraPreview, PhrasePanel } from "../../components/phrase";
import { BackspaceIcon, PhoneIcon } from "../../components/icons";
import { COUNTRY_CODES, digitsOnly, formatDisplay, isCallableNumber, presentRemote, toE164 } from "../../phone/numbers";
import { SimulationDeck } from "../../dev/SimulationDeck";
import type { AdapterKind } from "../../adapters/port";

type Tab = "keypad" | "recents";

export function PhoneApp({
  onPlayground,
  onMeet,
  onConnection,
}: {
  onPlayground: () => void;
  onMeet: () => void;
  onConnection: () => void;
}) {
  const session = useSession();
  const [tab, setTab] = useState<Tab>("keypad");
  const [deck, setDeck] = useState(false);
  const incoming = session.callScreenVisible && session.model.call === "ringing" && session.model.direction === "inbound";
  const inCall = session.callScreenVisible && !incoming;

  return (
    <div className="phone">
      {session.kind === "simulation" ? (
        <button type="button" className="sim-banner" onClick={() => setDeck(true)}>
          <span className="dot" />
          Simulation. This is not a live call.
        </button>
      ) : null}
      <SoundToast />
      {incoming ? <IncomingCall /> : null}
      {inCall ? <ActiveCall onPlayground={onPlayground} /> : null}
      {!incoming && !inCall ? (
        <>
          <div className="phone-body">
            {tab === "keypad" ? <Keypad onConnection={onConnection} /> : <Recents onMeet={onMeet} />}
          </div>
          <nav className="tabbar" aria-label="Phone">
            <button type="button" aria-current={tab === "keypad" ? "page" : undefined} onClick={() => setTab("keypad")}>Keypad</button>
            <button type="button" aria-current={tab === "recents" ? "page" : undefined} onClick={() => setTab("recents")}>Recents</button>
            <button type="button" onClick={onPlayground}>Playground</button>
          </nav>
        </>
      ) : null}
      <SimulationDeck open={deck} onClose={() => setDeck(false)} />
    </div>
  );
}

function SoundToast() {
  const { model } = useSession();
  const latest = model.sounds.at(-1);
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    if (!latest) return;
    setId(latest.id);
    const timer = window.setTimeout(() => setId((current) => (current === latest.id ? null : current)), 4200);
    return () => window.clearTimeout(timer);
  }, [latest]);
  if (!latest || id !== latest.id) return null;
  return (
    <p className="toast" role="status">
      Nearby sound: {latest.label}
    </p>
  );
}

function Keypad({ onConnection }: { onConnection: () => void }) {
  const session = useSession();
  const [prefix, setPrefix] = useState<(typeof COUNTRY_CODES)[number]>("+1");
  const [digits, setDigits] = useState("");
  const [hint, setHint] = useState("");
  const e164 = toE164(prefix, digits);
  const valid = isCallableNumber(e164);
  const link = session.link;
  const serviceHint = session.kind === "simulation"
    ? "Calls here are simulated. No phone will ring."
    : link.state === "open"
      ? "Server link is open."
      : link.state === "error" || link.state === "closed"
        ? link.reason
        : link.state === "idle" && link.reason
          ? link.reason
          : "No call server is connected.";

  async function place() {
    if (!valid) {
      setHint("Enter the full number, including the area code.");
      return;
    }
    setHint("");
    const result = await session.dial(e164);
    if (!result.accepted) setHint(result.reason ?? "The call was not accepted.");
  }

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];
  const letters: Record<string, string> = {
    "2": "ABC",
    "3": "DEF",
    "4": "GHI",
    "5": "JKL",
    "6": "MNO",
    "7": "PQRS",
    "8": "TUV",
    "9": "WXYZ",
  };

  return (
    <section className="keypad" aria-label="Keypad">
      <div className="keypad-top">
        <p className="wordmark">Sign2Speak</p>
        <button type="button" className="btn btn-text" onClick={onConnection}>Connection</button>
      </div>
      <div className="dial-display">
        <button
          type="button"
          className="prefix"
          aria-label={`Country code ${prefix}`}
          onClick={() => {
            const index = COUNTRY_CODES.indexOf(prefix);
            setPrefix(COUNTRY_CODES[(index + 1) % COUNTRY_CODES.length]);
          }}
        >
          {prefix}
        </button>
        <p className={digits ? "dial-number" : "dial-number is-empty"}>{digits ? formatDisplay(prefix, digits) : "Phone number"}</p>
      </div>
      <p className="hint" role="status">{hint || serviceHint}</p>
      <div className="keypad-pad">
      <div className="key-grid">
        {keys.map((key) => (
          <button
            key={key}
            type="button"
            className="key"
            onClick={() => {
              if (digitsOnly(digits).length >= 14 && key !== "*" && key !== "#") return;
              setDigits((current) => current + key);
            }}
          >
            <span>{key}</span>
            {letters[key] ? <small>{letters[key]}</small> : <small>{key === "0" ? "+" : " "}</small>}
          </button>
        ))}
      </div>
      <div className="call-row">
        <span />
        <button type="button" className="call-go" onClick={() => void place()} aria-label="Call">
          <PhoneIcon />
        </button>
        <button type="button" className="key key-icon" aria-label="Delete digit" onClick={() => setDigits((current) => current.slice(0, -1))}>
          <BackspaceIcon />
        </button>
      </div>
      </div>
    </section>
  );
}

function Recents({ onMeet }: { onMeet: () => void }) {
  const session = useSession();
  const [items, setItems] = useState<Array<{ id: string; remote: string; state: string; simulated: boolean }>>([]);
  const previous = useRef(session.model.call);
  useEffect(() => {
    const call = session.model.call;
    if ((call === "ended" || call === "failed") && previous.current !== call && session.model.remote && session.model.sessionId) {
      const entry = {
        id: session.model.sessionId,
        remote: session.model.remote,
        state: call,
        simulated: session.kind === "simulation",
      };
      setItems((list) => [entry, ...list.filter((item) => item.id !== entry.id)].slice(0, 8));
    }
    previous.current = call;
  }, [session.kind, session.model.call, session.model.remote, session.model.sessionId]);

  return (
    <section className="recents" aria-label="Recents">
      <h1>Recents</h1>
      {items.length === 0 ? <p className="empty-copy">No calls yet.</p> : null}
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <strong>{item.remote}</strong>
            <span>{item.simulated ? "Simulated" : "Call"} · {item.state}</span>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-text" onClick={onMeet}>Meeting overlay preview</button>
    </section>
  );
}

function IncomingCall() {
  const session = useSession();
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce) navigator.vibrate?.([160, 90, 160]);
  }, []);
  return (
    <section className="incoming" aria-label="Incoming call">
      <p className="eyebrow">{session.kind === "simulation" ? "Incoming sample" : "Incoming call"}</p>
      <h1>{presentRemote(session.model.remote)}</h1>
      <ConnectionBadge state={session.model.call} />
      {session.rejection ? <ErrorBanner message={session.rejection} onDismiss={session.clearRejection} /> : null}
      <div className="incoming-actions">
        <button type="button" className="call-go decline" onClick={() => void session.hangup()}>
          Decline
        </button>
        <button type="button" className="call-go" onClick={() => void session.answer()}>
          Answer
        </button>
      </div>
    </section>
  );
}

function ActiveCall({ onPlayground }: { onPlayground: () => void }) {
  const session = useSession();
  const [camera, setCamera] = useState(true);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const ended = session.model.call === "ended" || session.model.call === "failed";
  return (
    <section className="call" aria-label="Active call">
      <header className="call-head">
        <div>
          <ConnectionBadge state={session.model.call} />
          <h1>{presentRemote(session.model.remote)}</h1>
          <p className="call-meta">
            <CallTimer
              connectedAt={session.model.connectedAt}
              endedAt={session.model.endedAt}
              running={session.model.call === "connected" || session.model.call === "reconnecting"}
            />
            <AudioDeviceStatus surface="phone" />
          </p>
        </div>
        {ended ? (
          <button type="button" className="end-call" onClick={session.dismissCallScreen}>Close</button>
        ) : (
          <button type="button" className="end-call" onClick={() => void session.hangup()}>End</button>
        )}
      </header>
      {session.rejection ? <ErrorBanner message={session.rejection} onDismiss={session.clearRejection} /> : null}
      {cameraError ? <ErrorBanner message={cameraError} onDismiss={() => setCameraError(null)} /> : null}
      <CaptionStream captions={session.model.captions} />
      <div className="signer-well">
        <CameraPreview active={camera} onActive={setCamera} onError={setCameraError} />
        <PhrasePanel />
        <button type="button" className="btn btn-text" onClick={onPlayground}>Playground</button>
      </div>
    </section>
  );
}

export function ConnectionSheet({
  open,
  kind,
  url,
  onClose,
  onApply,
}: {
  open: boolean;
  kind: AdapterKind;
  url: string;
  onClose: () => void;
  onApply: (kind: AdapterKind, url: string) => void;
}) {
  const [nextKind, setNextKind] = useState(kind);
  const [nextUrl, setNextUrl] = useState(url);
  useEffect(() => {
    setNextKind(kind);
    setNextUrl(url);
  }, [kind, url, open]);
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-labelledby="connection-title" onClick={(event) => event.stopPropagation()}>
        <h2 id="connection-title">Connection</h2>
        <div className="mode-switch">
          <button type="button" aria-pressed={nextKind === "simulation"} onClick={() => setNextKind("simulation")}>Simulation</button>
          <button type="button" aria-pressed={nextKind === "live"} onClick={() => setNextKind("live")}>Live server</button>
        </div>
        {nextKind === "live" ? (
          <label className="type-label">
            WebSocket address
            <input value={nextUrl} onChange={(event) => setNextUrl(event.target.value)} placeholder="wss://example.com/ws" />
          </label>
        ) : (
          <p className="hint">Sample events stay on this device. Nothing is sent to a phone network.</p>
        )}
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            localStorage.setItem("s2s-ws", nextUrl);
            onApply(nextKind, nextUrl);
            onClose();
          }}
        >
          Use this connection
        </button>
      </div>
    </div>
  );
}
