import assert from "node:assert/strict";
import test from "node:test";
import type { AppEvent } from "../contracts/events.ts";
import { initialModel, mergeTracking, reduce } from "./model.ts";

test("captions with the same id update in place", () => {
  const partial: AppEvent = {
    type: "caption.update",
    caption: {
      id: "c1",
      sessionId: "s",
      text: "Can you",
      isFinal: false,
      startMs: 1,
    },
  };
  const finalCaption: AppEvent = {
    type: "caption.update",
    caption: {
      id: "c1",
      sessionId: "s",
      text: "Can you hear me?",
      isFinal: true,
      startMs: 1,
      endMs: 2,
    },
  };
  const next = reduce(reduce({ ...initialModel, sessionId: "s" }, partial), finalCaption);
  assert.equal(next.captions.length, 1);
  assert.equal(next.captions[0].text, "Can you hear me?");
  assert.equal(next.captions[0].isFinal, true);
});

test("a language reply stays attached to the words that asked for it", () => {
  const next = reduce(initialModel, {
    type: "language.reply",
    requestId: "r",
    sessionId: "s",
    sourceText: "five minutes",
    reply: "I'll be there in five minutes.",
    timestampMs: 1,
  });
  assert.equal(next.reply?.sourceText, "five minutes");
  assert.equal(next.reply?.text, "I'll be there in five minutes.");
});

test("a call becomes connected only from a call status event", () => {
  const dialIsNotAnEvent = reduce(initialModel, {
    type: "tracking.status",
    state: "tracking",
    timestampMs: 1,
  });
  assert.equal(dialIsNotAnEvent.call, "idle");
  const connected = reduce(initialModel, {
    type: "call.status",
    sessionId: "s",
    state: "connected",
    timestampMs: 10,
    remote: "+15555550100",
  });
  assert.equal(connected.call, "connected");
  assert.equal(connected.connectedAt, 10);
});

test("ending a call freezes the connected timestamp", () => {
  const connected = reduce(initialModel, {
    type: "call.status",
    sessionId: "s",
    state: "connected",
    timestampMs: 10,
  });
  const ended = reduce(connected, {
    type: "call.status",
    sessionId: "s",
    state: "ended",
    timestampMs: 40,
  });
  assert.equal(ended.call, "ended");
  assert.equal(ended.connectedAt, 10);
  assert.equal(ended.endedAt, 40);
});

test("older recognition revisions are ignored", () => {
  const first = reduce(initialModel, {
    type: "recognition.result",
    result: {
      id: "r",
      sessionId: "s",
      revision: 2,
      text: "later",
      status: "final",
      timestampMs: 2,
    },
  });
  const older = reduce(first, {
    type: "recognition.result",
    result: {
      id: "r",
      sessionId: "s",
      revision: 1,
      text: "earlier",
      status: "partial",
      timestampMs: 1,
    },
  });
  assert.equal(older.recognition?.text, "later");
});

test("an in-flight speech status is not replaced by an older message", () => {
  const speaking = reduce({ ...initialModel, sessionId: "s" }, {
    type: "speech.status",
    sessionId: "s",
    messageId: "new",
    state: "speaking",
    timestampMs: 2,
  });
  const stale = reduce(speaking, {
    type: "speech.status",
    sessionId: "s",
    messageId: "old",
    state: "queued",
    timestampMs: 3,
  });
  assert.equal(stale.speech?.messageId, "new");
  assert.equal(stale.speech?.state, "speaking");
});

test("local camera state wins while the pipeline is running", () => {
  assert.equal(mergeTracking("running", "no_hands", "tracking"), "no_hands");
  assert.equal(mergeTracking("running", "tracking", "recognizing"), "recognizing");
  assert.equal(mergeTracking("off", "camera_off", "tracking"), "tracking");
});
