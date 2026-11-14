import { useEffect, useState } from "react";
import type { AdapterKind } from "./adapters/port";
import { SessionProvider } from "./state/SessionProvider";
import { ConnectionSheet, PhoneApp } from "./surfaces/phone/PhoneApp";
import { MeetStage } from "./surfaces/meet/MeetStage";
import { GestureSynth } from "./surfaces/synth/GestureSynth";

type Route = "phone" | "meet" | "synth";

function readRoute(): Route {
  if (location.pathname.startsWith("/meet")) return "meet";
  if (location.pathname.startsWith("/synth")) return "synth";
  return "phone";
}

export function App() {
  const [kind, setKind] = useState<AdapterKind>(() => (location.search.includes("live=1") ? "live" : "simulation"));
  const [url, setUrl] = useState(() => localStorage.getItem("s2s-ws") ?? "");
  return (
    <SessionProvider key={`${kind}:${url}`} kind={kind} liveUrl={url}>
      <Root kind={kind} url={url} onApply={(nextKind, nextUrl) => { setKind(nextKind); setUrl(nextUrl); }} />
    </SessionProvider>
  );
}

function Root({
  kind,
  url,
  onApply,
}: {
  kind: AdapterKind;
  url: string;
  onApply: (kind: AdapterKind, url: string) => void;
}) {
  const [route, setRoute] = useState<Route>(readRoute);
  const [connectionOpen, setConnectionOpen] = useState(false);

  function go(next: Route) {
    const path = next === "phone" ? "/" : `/${next}`;
    history.pushState({}, "", path);
    setRoute(next);
  }

  useEffect(() => {
    const onPop = () => setRoute(readRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return (
    <div className="app-root">
      {route === "meet" ? <MeetStage onBack={() => go("phone")} /> : (
        <div className="phone-wrap">
          <PhoneApp onPlayground={() => go("synth")} onMeet={() => go("meet")} onConnection={() => setConnectionOpen(true)} />
        </div>
      )}
      {route === "synth" ? <GestureSynth onBack={() => go("phone")} /> : null}
      <ConnectionSheet open={connectionOpen} kind={kind} url={url} onClose={() => setConnectionOpen(false)} onApply={onApply} />
    </div>
  );
}
