import assert from "node:assert/strict";
import test from "node:test";
import { applyRecognition, emptyDraft, phrasePhase } from "./draft.ts";
import type { RecognitionResult } from "../contracts/events.ts";

function result(overrides: Partial<RecognitionResult> = {}): RecognitionResult {
  return {
    id: "r",
    sessionId: "s",
    revision: 1,
    text: "Hello",
    status: "final",
    timestampMs: 1,
    ...overrides,
  };
}

test("a clean draft takes the recognition text", () => {
  const next = applyRecognition(emptyDraft, result({ text: "Hello there" }));
  assert.equal(next.text, "Hello there");
  assert.equal(next.dirty, false);
});

test("a dirty draft keeps the signer edit and holds the new result", () => {
  const dirty = { ...emptyDraft, text: "My words", dirty: true, resultId: "r", revision: 1 };
  const next = applyRecognition(dirty, result({ revision: 2, text: "Other words" }));
  assert.equal(next.text, "My words");
  assert.equal(next.pending?.text, "Other words");
});

test("uncertain results stay in review until approved", () => {
  const draft = applyRecognition(emptyDraft, result({ status: "uncertain" }));
  assert.equal(phrasePhase(draft, result({ status: "uncertain" })), "uncertain");
  assert.equal(phrasePhase({ ...draft, approved: true }, result({ status: "uncertain" })), "approved");
});
