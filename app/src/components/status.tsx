import { useEffect, useState } from "react";
import type { AudioRoute, Caption, ConnectionState, SpeechState, TrackingState } from "../contracts/events";
import type { AdapterKind } from "../adapters/port";
import { useSession } from "../state/SessionProvider";
import { connectionLabel, formatDuration, speakerLabel, speechLabel, trackingLabel } from "./copy";

export function ConnectionBadge({ state }: { state: ConnectionState }) {
  return (
    <p className="badge" data-state={state}>
      <span className="dot" />
      <span>{connectionLabel(state)}</span>
    </p>
  );
}

export function TrackingStateView({ state }: { state: TrackingState }) {
  return (
    <p className="badge badge-quiet" data-state={state}>
      <span className="dot" />
      <span>{trackingLabel(state)}</span>
    </p>
  );
}

export function SpeechProgress({ state, detail }: { state?: SpeechState; detail?: string }) {
  if (!state) return null;
  return (
    <p className="speech-progress" data-state={state} role="status">
      <span className="dot" />
      {speechLabel(state)}
      {detail ? <span className="speech-detail">{detail}</span> : null}
    </p>
  );
}

export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div className="banner banner-error" role="alert">
      <p>{message}</p>
      {onDismiss ? (
        <button type="button" onClick={onDismiss}>
          Dismiss
        </button>
      ) : null}
    </div>
  );
}

export function routeSentence(route: AudioRoute | undefined, kind: AdapterKind, surface: "phone" | "meet"): string {
  if (kind === "simulation") {
    return surface === "phone"
      ? "Sample line. No phone will ring."
      : "Only on your screen. Meeting audio is not connected.";
  }
  if (!route || route.state === "unavailable") {
    return surface === "phone" ? "Phone audio is unavailable." : "Meeting audio output is not connected.";
  }
  if (route.state === "error") return route.errorMessage ?? "The audio route failed.";
  if (route.state === "ready") {
    return route.deviceLabel
      ? `Voice route ready: ${route.deviceLabel}.`
      : "Voice route is ready.";
  }
  return route.deviceLabel ? `Voice route active: ${route.deviceLabel}.` : "Voice route is active.";
}

export function AudioDeviceStatus({ surface }: { surface: "phone" | "meet" }) {
  const { model, kind } = useSession();
  return <p className="route-line">{routeSentence(model.route, kind, surface)}</p>;
}

export function CallTimer({ connectedAt, endedAt, running }: { connectedAt?: number; endedAt?: number; running: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running, connectedAt]);
  if (!connectedAt) return null;
  const stamp = running ? now : endedAt ?? now;
  return <span className="timer">{formatDuration(stamp - connectedAt)}</span>;
}

export function CaptionStream({ captions }: { captions: Caption[] }) {
  const { captionScale, setCaptionScale } = useSession();
  const finals = captions.filter((caption) => caption.isFinal);
  const partial = [...captions].reverse().find((caption) => !caption.isFinal);
  const hero = partial ?? finals.at(-1);
  const history = finals.filter((caption) => caption.id !== hero?.id).slice(-2);
  const announcement = finals.at(-1);
  return (
    <section className="caption-stage" style={{ ["--caption-scale" as string]: String(captionScale) }} aria-label="Live captions">
      <div className="caption-tools">
        <p className="eyebrow">{hero ? speakerLabel(hero.speakerId) : "Waiting"}</p>
        <div className="scale-controls">
          <button type="button" onClick={() => setCaptionScale(captionScale - 0.1)} aria-label="Smaller captions">
            A
          </button>
          <button type="button" className="scale-lg" onClick={() => setCaptionScale(captionScale + 0.1)} aria-label="Larger captions">
            A
          </button>
        </div>
      </div>
      <p className="caption-hero" data-partial={hero ? !hero.isFinal : false}>
        {hero?.text || "Their words will appear here."}
      </p>
      <div className="caption-history">
        {history.map((caption) => (
          <p key={`${caption.id}-${caption.endMs ?? caption.startMs}`}>{caption.text}</p>
        ))}
      </div>
      <p className="sr-only" aria-live="polite">
        {announcement ? `${speakerLabel(announcement.speakerId)}. ${announcement.text}` : ""}
      </p>
    </section>
  );
}
