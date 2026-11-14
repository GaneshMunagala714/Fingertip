import type { RecognitionResult } from "../contracts/events";

export type DraftState = {
  text: string;
  dirty: boolean;
  editing: boolean;
  resultId?: string;
  revision: number;
  dismissedResultId?: string;
  approved: boolean;
  pending: RecognitionResult | null;
};

export const emptyDraft: DraftState = {
  text: "",
  dirty: false,
  editing: false,
  revision: 0,
  approved: false,
  pending: null,
};

export function applyRecognition(draft: DraftState, result: RecognitionResult): DraftState {
  if (draft.dismissedResultId === result.id && result.revision <= draft.revision) return draft;
  if (draft.dirty || draft.editing) {
    if (draft.resultId === result.id && result.revision <= draft.revision) return draft;
    return { ...draft, pending: result };
  }
  return {
    ...draft,
    text: result.text,
    resultId: result.id,
    revision: result.revision,
    pending: null,
    approved: false,
    dismissedResultId: undefined,
  };
}

export type PhrasePhase = "empty" | "partial" | "final" | "uncertain" | "approved";

export function phrasePhase(
  draft: DraftState,
  result: RecognitionResult | undefined,
): PhrasePhase {
  if (draft.approved) return "approved";
  if (!result || draft.dismissedResultId === result.id) {
    return draft.text.trim() ? "final" : "empty";
  }
  if (draft.dirty) return "final";
  if (result.status === "uncertain") return "uncertain";
  if (result.status === "partial") return "partial";
  return "final";
}
