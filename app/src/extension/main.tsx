import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import css from "../styles/app.css?inline";
import type { AdapterKind } from "../adapters/port";
import { SessionProvider } from "../state/SessionProvider";
import { MeetOverlay } from "../surfaces/meet/MeetOverlay";

const HOST_ID = "sign2speak-extension-root";

type Settings = {
  enabled: boolean;
  wsUrl: string;
  allowSimulation: boolean;
};

type ChromeStorage = {
  storage?: {
    local: {
      get: (keys: string[], callback: (items: Record<string, unknown>) => void) => void;
    };
    onChanged?: { addListener: (listener: () => void) => void };
  };
};

function chromeStorage(): ChromeStorage | undefined {
  return (globalThis as { chrome?: ChromeStorage }).chrome;
}

function readSettings(): Promise<Settings> {
  const fallback = { enabled: false, wsUrl: "", allowSimulation: false };
  const chromeApi = chromeStorage();
  if (!chromeApi?.storage?.local) return Promise.resolve(fallback);
  return new Promise((resolve) => {
    chromeApi.storage!.local.get(["enabled", "wsUrl", "allowSimulation"], (items) => {
      resolve({
        enabled: items.enabled === true,
        wsUrl: typeof items.wsUrl === "string" ? items.wsUrl : "",
        allowSimulation: items.allowSimulation === true,
      });
    });
  });
}

function ExtensionApp() {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    void readSettings().then(setSettings);
    chromeStorage()?.storage?.onChanged?.addListener(() => {
      void readSettings().then(setSettings);
    });
  }, []);
  if (!settings?.enabled) return null;
  const kind: AdapterKind = settings.allowSimulation ? "simulation" : settings.wsUrl ? "live" : "idle";
  return (
    <SessionProvider key={`${kind}:${settings.wsUrl}:${settings.allowSimulation}`} kind={kind} liveUrl={settings.wsUrl}>
      <MeetOverlay anchor={null} />
    </SessionProvider>
  );
}

function mount() {
  if (document.getElementById(HOST_ID)) return;
  const host = document.createElement("div");
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `:host{all:initial;}${css.replace(":root,\n:host", ":host")}`;
  const mountPoint = document.createElement("div");
  shadow.append(style, mountPoint);
  document.documentElement.appendChild(host);
  createRoot(mountPoint).render(
    <StrictMode>
      <ExtensionApp />
    </StrictMode>,
  );
}

mount();
