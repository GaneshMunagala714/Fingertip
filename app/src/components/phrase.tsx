import { useEffect, useRef } from "react";
import { speechLabel } from "./copy";
import { TrackingStateView } from "./status";
import { useSession } from "../state/SessionProvider";
import { acquireCamera, releaseCamera } from "../perception/hands";

export function CameraPreview({
  active,
  onActive,
  onError,
}: {
  active: boolean;
  onActive: (active: boolean) => void;
  onError: (message: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onActiveRef = useRef(onActive);
  const onErrorRef = useRef(onError);
  const { model } = useSession();
  onActiveRef.current = onActive;
  onErrorRef.current = onError;
  useEffect(() => {
    const video = videoRef.current;
    if (!active || !video) return;
    let gone = false;
    acquireCamera(video).catch((error: unknown) => {
      if (gone) return;
      onActiveRef.current(false);
      onErrorRef.current(error instanceof Error ? error.message : "Camera could not start.");
    });
    return () => {
      gone = true;
      releaseCamera(video);
    };
  }, [active]);

  return (
    <div className="camera-frame">
      <video ref={videoRef} className={active ? "camera-video" : "camera-video is-hidden"} playsInline muted autoPlay />
      {!active ? (
        <div className="camera-empty">
          <p>Camera permission is needed to see your hands.</p>
          <button type="button" className="btn btn-secondary" onClick={() => onActive(true)}>
            Allow camera
          </button>
        </div>
      ) : (
        <TrackingStateView state={model.tracking} />
      )}
    </div>
  );
}

export function PhrasePanel({ compact = false }: { compact?: boolean }) {
  const session = useSession();
  const { draft, model, phase, replyText } = session;
  const result = model.recognition;
  const speaking = model.speech && ["queued", "preparing", "speaking"].includes(model.speech.state);
  const waiting = model.call === "connecting" || model.call === "ringing";
  const ended = model.call === "ended" || model.call === "failed";

  return (
    <div className={compact ? "phrase is-compact" : "phrase"} data-phase={phase}>
      <div className="phrase-meta">
        <span className="tag" data-phase={phase}>
          {phase === "empty" && "A word or two"}
          {phase === "partial" && "Draft"}
          {phase === "final" && "Ready"}
          {phase === "uncertain" && "Review"}
          {phase === "approved" && "Approved"}
        </span>
        {model.speech ? <span className="speech-inline">{speechLabel(model.speech.state)}</span> : null}
      </div>

      <input
        className="gloss-input"
        aria-label="A word or two"
        placeholder="A word or two"
        value={draft.text}
        onChange={(event) => session.updateDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void session.speak();
          }
        }}
      />

      <label className="reply-label">
        Spoken reply
        <textarea
          className="reply-line"
          aria-label="Spoken reply"
          rows={compact ? 2 : 3}
          placeholder="A full sentence will appear here."
          value={replyText}
          onChange={(event) => session.editReply(event.target.value)}
        />
      </label>

      {phase === "uncertain" && result?.alternatives?.length ? (
        <div className="alternatives">
          {result.alternatives
            .filter((alternative) => alternative.text !== draft.text)
            .map((alternative) => (
              <button key={alternative.id} type="button" onClick={() => session.selectAlternative(alternative.text)}>
                {alternative.text}
              </button>
            ))}
        </div>
      ) : null}

      {draft.pending ? (
        <button type="button" className="pending-phrase" onClick={session.acceptPending}>
          A new phrase is ready. Use it.
        </button>
      ) : null}

      {model.speech?.errorMessage ? <p className="inline-error">{model.speech.errorMessage}</p> : null}

      <div className="composer">
        {speaking ? (
          <button type="button" className="btn btn-speak" onClick={() => void session.cancelSpeech()}>
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-speak"
            disabled={waiting || ended || !replyText.trim() || session.busy}
            onClick={() => void session.speak()}
          >
            Speak
          </button>
        )}
      </div>
      {phase === "uncertain" ? (
        <button type="button" className="btn btn-text" onClick={session.retryRecognition}>
          Try again
        </button>
      ) : null}
      {waiting ? <p className="hint">Speaking waits until the call is connected.</p> : null}
    </div>
  );
}

export function VoiceSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const session = useSession();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector("button")?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="voice-title"
        ref={ref}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="voice-title">Voice</h2>
        <p className="hint">Preview plays on this device only. It does not enter the call.</p>
        {session.voices.length === 0 ? <p>The voice is set by the call.</p> : null}
        <div className="voice-list">
          {session.voices.map((voice) => (
            <div key={voice.id} className="voice-row">
              <button
                type="button"
                aria-pressed={session.voiceId === voice.id}
                onClick={() => session.setVoiceId(voice.id)}
              >
                <strong>{voice.label}</strong>
                {voice.description ? <span>{voice.description}</span> : null}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => session.previewVoice(voice)}>
                Preview here
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Back to call
        </button>
      </div>
    </div>
  );
}
