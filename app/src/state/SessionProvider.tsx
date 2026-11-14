import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ClientCommand, CommandResult, VoiceOption } from "../contracts/commands";
import type { SpeechState } from "../contracts/events";
import { createPort } from "../adapters/create";
import type { AdapterKind, LinkStatus, SimulationControls } from "../adapters/port";
import { subscribePerception } from "../perception/hands";
import { applyRecognition, emptyDraft, phrasePhase, type DraftState, type PhrasePhase } from "./draft";
import { initialModel, mergeTracking, reduce, type CameraPipeline, type SessionModel } from "./model";

export type SessionApi = {
  model: SessionModel;
  kind: AdapterKind;
  link: LinkStatus;
  draft: DraftState;
  phase: PhrasePhase;
  voices: VoiceOption[];
  voiceId: string | null;
  rejection: string | null;
  busy: boolean;
  captionScale: number;
  callScreenVisible: boolean;
  simulation: SimulationControls | null;
  replyText: string;
  setVoiceId: (id: string) => void;
  editReply: (text: string) => void;
  setCaptionScale: (scale: number) => void;
  updateDraft: (text: string) => void;
  setEditing: (editing: boolean) => void;
  selectAlternative: (text: string) => void;
  acceptPending: () => void;
  discardDraft: () => Promise<void>;
  retryRecognition: () => void;
  speak: () => Promise<void>;
  cancelSpeech: () => Promise<void>;
  dial: (number: string) => Promise<CommandResult>;
  answer: () => Promise<void>;
  hangup: () => Promise<void>;
  previewVoice: (voice: VoiceOption) => void;
  dismissCallScreen: () => void;
  clearRejection: () => void;
};

const SessionContext = createContext<SessionApi | null>(null);

export function useSession(): SessionApi {
  const value = useContext(SessionContext);
  if (!value) throw new Error("Sign2Speak session is missing.");
  return value;
}

function speechBlocksStop(state: SpeechState | undefined): boolean {
  return state === "queued" || state === "preparing" || state === "speaking";
}

function spokenLine(source: string, reply: SessionModel["reply"], edit: string | null): string {
  if (edit !== null) return edit;
  const words = source.trim();
  if (!words) return "";
  if (words.split(/\s+/).length > 8) return words;
  if (reply && reply.sourceText.trim() === words) return reply.text;
  return "";
}

export function SessionProvider({
  kind,
  liveUrl,
  children,
}: {
  kind: AdapterKind;
  liveUrl?: string;
  children: ReactNode;
}) {
  const port = useMemo(() => createPort(kind, liveUrl), [kind, liveUrl]);
  const [model, setModel] = useState<SessionModel>(initialModel);
  const [link, setLink] = useState<LinkStatus>({ state: "idle" });
  const [draft, setDraft] = useState<DraftState>(emptyDraft);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [captionScale, setCaptionScaleState] = useState(1);
  const [pipeline, setPipeline] = useState<CameraPipeline>("off");
  const [localTracking, setLocalTracking] = useState(initialModel.tracking);
  const [dismissedSession, setDismissedSession] = useState<string | null>(null);
  const [replyEdit, setReplyEdit] = useState<string | null>(null);
  const modelRef = useRef(model);
  const draftRef = useRef(draft);
  const voiceRef = useRef(voiceId);
  const replyEditRef = useRef(replyEdit);
  modelRef.current = model;
  draftRef.current = draft;
  voiceRef.current = voiceId;
  replyEditRef.current = replyEdit;

  useEffect(() => {
    const stored = Number(localStorage.getItem("s2s-caption-scale"));
    if (stored >= 0.85 && stored <= 1.7) setCaptionScaleState(stored);
  }, []);

  useEffect(() => {
    port.start();
    const offEvents = port.subscribe((event) => {
      setModel((current) => reduce(current, event));
      if (event.type === "recognition.result") {
        setDraft((current) => applyRecognition(current, event.result));
        setReplyEdit(null);
      }
    });
    const offStatus = port.onStatus(setLink);
    let cancel = false;
    port.listVoices().then((list) => {
      if (cancel) return;
      setVoices(list);
      setVoiceId((current) => current ?? list[0]?.id ?? null);
    }).catch(() => {
      if (!cancel) setVoices([]);
    });
    return () => {
      cancel = true;
      offEvents();
      offStatus();
      port.stop();
    };
  }, [port]);

  useEffect(() => subscribePerception((next) => {
    setPipeline(next.pipeline);
    setLocalTracking(next.state);
  }), []);

  const merged = useMemo<SessionModel>(() => ({
    ...model,
    tracking: mergeTracking(pipeline, localTracking, model.tracking),
  }), [localTracking, model, pipeline]);

  const callScreenVisible = Boolean(merged.sessionId) && merged.call !== "idle" && dismissedSession !== merged.sessionId;
  const replyText = spokenLine(draft.text, merged.reply, replyEdit);

  useEffect(() => {
    const text = draft.text.trim();
    if (!text || text.split(/\s+/).length > 8) return;
    const sessionId = model.sessionId ?? "local";
    const timer = window.setTimeout(() => {
      void port.command({
        type: "language.expand",
        requestId: crypto.randomUUID(),
        sessionId,
        text,
      });
    }, 320);
    return () => window.clearTimeout(timer);
  }, [draft.text, model.sessionId, port]);

  async function command(body: ClientCommand): Promise<CommandResult> {
    setBusy(true);
    setRejection(null);
    try {
      const result = await port.command(body);
      if (!result.accepted) setRejection(result.reason ?? "The server did not accept that.");
      return result;
    } finally {
      setBusy(false);
    }
  }

  const api = useMemo<SessionApi>(() => ({
    model: merged,
    kind,
    link,
    draft,
    phase: phrasePhase(draft, model.recognition),
    voices,
    voiceId,
    rejection,
    busy,
    captionScale,
    callScreenVisible,
    simulation: port.simulation,
    replyText,
    setVoiceId,
    editReply(text) {
      setReplyEdit(text);
    },
    setCaptionScale(scale) {
      const next = Math.min(1.7, Math.max(0.85, scale));
      setCaptionScaleState(next);
      localStorage.setItem("s2s-caption-scale", String(next));
    },
    updateDraft(text) {
      setReplyEdit(null);
      setDraft((current) => ({ ...current, text, dirty: true, approved: false, editing: true }));
    },
    setEditing(editing) {
      setDraft((current) => ({ ...current, editing }));
    },
    selectAlternative(text) {
      setReplyEdit(null);
      setDraft((current) => ({ ...current, text, dirty: true, approved: false, pending: null }));
    },
    acceptPending() {
      setReplyEdit(null);
      setDraft((current) => (current.pending ? applyRecognition({ ...emptyDraft }, current.pending) : current));
    },
    async discardDraft() {
      const speech = modelRef.current.speech;
      const sessionId = modelRef.current.sessionId;
      if (speech && speechBlocksStop(speech.state) && sessionId) {
        const result = await command({
          type: "speech.cancel",
          requestId: crypto.randomUUID(),
          sessionId,
          messageId: speech.messageId,
        });
        if (!result.accepted) return;
      }
      setDraft(emptyDraft);
    },
    retryRecognition() {
      const current = modelRef.current.recognition;
      setDraft({
        ...emptyDraft,
        dismissedResultId: current?.id,
        revision: current?.revision ?? 0,
      });
    },
    async speak() {
      const call = modelRef.current.call;
      const text = spokenLine(draftRef.current.text, modelRef.current.reply, replyEditRef.current).trim();
      if (call === "connecting" || call === "ringing") {
        setRejection("Speaking waits until the call is connected.");
        return;
      }
      if (call === "ended" || call === "failed") {
        setRejection("This call has ended.");
        return;
      }
      if (!text) {
        setRejection("The full reply is not ready yet.");
        return;
      }
      const sessionId = modelRef.current.sessionId ?? "local";
      const result = await command({
        type: "speech.speak",
        requestId: crypto.randomUUID(),
        sessionId,
        text,
        voiceId: voiceRef.current ?? undefined,
      });
      if (result.accepted) setDraft((current) => ({ ...current, approved: true, editing: false }));
    },
    async cancelSpeech() {
      const speech = modelRef.current.speech;
      const sessionId = modelRef.current.sessionId;
      if (!speech || !sessionId || !speechBlocksStop(speech.state)) return;
      await command({
        type: "speech.cancel",
        requestId: crypto.randomUUID(),
        sessionId,
        messageId: speech.messageId,
      });
    },
    dial(number) {
      return command({ type: "call.dial", requestId: crypto.randomUUID(), number });
    },
    async answer() {
      const sessionId = modelRef.current.sessionId;
      if (!sessionId) {
        setRejection("There is no ringing call to answer.");
        return;
      }
      await command({ type: "call.answer", requestId: crypto.randomUUID(), sessionId });
    },
    async hangup() {
      const sessionId = modelRef.current.sessionId;
      if (!sessionId) {
        setRejection("There is no call to end.");
        return;
      }
      await command({ type: "call.hangup", requestId: crypto.randomUUID(), sessionId });
    },
    previewVoice(voice) {
      if (!("speechSynthesis" in window)) {
        setRejection("This device has no local voice preview.");
        return;
      }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(`This is the ${voice.label} preview on this device.`);
      utterance.rate = 1;
      window.speechSynthesis.speak(utterance);
    },
    dismissCallScreen() {
      const sessionId = modelRef.current.sessionId;
      if (sessionId) setDismissedSession(sessionId);
    },
    clearRejection() {
      setRejection(null);
    },
  }), [busy, callScreenVisible, captionScale, draft, kind, link, merged, model.recognition, port.simulation, rejection, replyText, voiceId, voices]);

  return <SessionContext.Provider value={api}>{children}</SessionContext.Provider>;
}
