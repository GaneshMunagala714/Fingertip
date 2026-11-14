import { useEffect, useRef, useState } from "react";
import { acquireCamera, readPerception, releaseCamera, subscribePerception } from "../../perception/hands";
import type { TrackingState } from "../../contracts/events";
import { useSession } from "../../state/SessionProvider";
import { AuroraWorld } from "./aurora";
import { expressionFromY, frameFromLandmarks, GestureTracker, midiFromX, noteName, pitchWord } from "./gestures";
import { Instrument } from "./instrument";

type Engine = { instrument: Instrument; world: AuroraWorld };
let engine: Engine | null = null;

export function GestureSynth({ onBack }: { onBack: () => void }) {
  const session = useSession();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const trackerRef = useRef(new GestureTracker());
  const soundRef = useRef(false);
  const [camera, setCamera] = useState(true);
  const [tracking, setTracking] = useState<TrackingState>("camera_off");
  const [error, setError] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [readout, setReadout] = useState("Raise your hand");
  const reduced = useRef(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const onCall = session.model.call === "connected" || session.model.call === "reconnecting";

  useEffect(() => subscribePerception((snapshot) => {
    setTracking(snapshot.state);
    if (snapshot.error) setError(snapshot.error);
  }), []);

  useEffect(() => {
    const video = videoRef.current;
    if (!camera || !video) return;
    let gone = false;
    acquireCamera(video).catch((reason: unknown) => {
      if (gone) return;
      setCamera(false);
      setError(reason instanceof Error ? reason.message : "Camera could not start.");
    });
    return () => {
      gone = true;
      releaseCamera(video);
    };
  }, [camera]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const world = new AuroraWorld(canvas, reduced.current);
    const instrument = new Instrument();
    const current: Engine = { instrument, world };
    engine = current;
    let frame = 0;
    let lastLabel = "";
    const loop = (time: number) => {
      const snapshot = readPerception();
      const hands = snapshot.hands.slice(0, 2).map((landmarks) => frameFromLandmarks(landmarks));
      while (hands.length < 2) hands.push(null);
      const events = trackerRef.current.update(hands, time);
      const primary = hands[0];
      world.setHand(primary?.x ?? 0.5, primary?.y ?? 0.5, Boolean(primary));
      if (primary && soundRef.current) instrument.express(expressionFromY(primary.y));
      let label = "";
      for (const event of events) {
        const onset = event.type === "note_on" || event.type === "chord_on";
        const ending = event.type === "note_off" || event.type === "chord_off";
        const audible = soundRef.current && instrument.ready;
        if (audible && (onset || ending)) instrument.play(event);
        if (onset || ending) world.push(event);
        if (event.type === "chord_on") label = `Chord · ${event.midis.map(noteName).join(" ")}`;
        else if (event.type === "note_on") label = `${noteName(event.midi)} · ${pitchWord(event.midi)}`;
      }
      if (!label && primary) label = `${noteName(midiFromX(primary.x))} · ${pitchWord(midiFromX(primary.x))}`;
      if (label && label !== lastLabel) {
        lastLabel = label;
        setReadout(label);
      }
      world.setEnergy(instrument.energy());
      world.frame(time);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    const onHide = () => {
      if (document.hidden) instrument.releaseAll();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onHide);
      void instrument.stop();
      if (engine === current) engine = null;
    };
  }, []);

  useEffect(() => {
    const node = sectionRef.current;
    if (!node) return;
    const arm = () => {
      const instrument = engine?.instrument;
      if (!instrument || soundRef.current) return;
      void instrument.resume().then(() => {
        soundRef.current = true;
        setSoundOn(true);
        setError(null);
      }).catch(() => {
        setError("Sound could not start. Tap the screen again.");
      });
    };
    node.addEventListener("pointerdown", arm);
    return () => node.removeEventListener("pointerdown", arm);
  }, []);

  const handsSeen = tracking === "tracking" || tracking === "recognizing";

  return (
    <section className="synth" aria-label="Gesture Synth" ref={sectionRef}>
      <video ref={videoRef} className="synth-video" playsInline muted autoPlay />
      <canvas ref={canvasRef} aria-label="Strings over the camera. Move across the strings to change pitch. Pinch one string for a note. Hold an open hand for a chord." />
      <div className="synth-ui">
        <header>
          <button type="button" onClick={onBack}>Back</button>
          <p>{onCall ? "Call still connected" : "Playground"}</p>
        </header>
        {error ? <p className="synth-error" role="alert">{error}</p> : null}
        {!camera || (error && /camera/i.test(error)) ? (
          <button
            type="button"
            className="synth-retry"
            onClick={() => {
              setError(null);
              setCamera(false);
              window.setTimeout(() => setCamera(true), 0);
            }}
          >
            Allow camera
          </button>
        ) : null}
        <p className="synth-readout" role="status">
          {handsSeen || readout !== "Raise your hand" ? readout : "Raise your hand"}
          {!soundOn && handsSeen ? " · Tap once to hear it" : ""}
        </p>
      </div>
    </section>
  );
}
