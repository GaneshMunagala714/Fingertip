import assert from "node:assert/strict";
import test from "node:test";
import { GestureTracker, midiFromX, type HandFrame } from "./gestures.ts";

function hand(overrides: Partial<HandFrame> = {}): HandFrame {
  return { x: 0.5, y: 0.5, pinch: 0.2, palm: false, ...overrides };
}

test("horizontal position chooses a stable pentatonic note", () => {
  assert.equal(midiFromX(0.05), 60);
  assert.ok(midiFromX(0.92) > midiFromX(0.2));
});

test("pinch onset fires once and release waits for hysteresis", () => {
  const tracker = new GestureTracker();
  const first = tracker.update([hand({ pinch: 0.03, x: 0.2 })], 1000);
  assert.equal(first.length, 1);
  assert.equal(first[0].type, "note_on");
  const held = tracker.update([hand({ pinch: 0.06, x: 0.8 })], 1100);
  assert.equal(held.length, 0);
  const still = tracker.update([hand({ pinch: 0.07, x: 0.8 })], 1200);
  assert.equal(still.length, 0);
  const released = tracker.update([hand({ pinch: 0.1, x: 0.8 })], 1300);
  assert.equal(released[0].type, "note_off");
  assert.equal(released[0].midi, first[0].midi);
});

test("an open palm held long enough starts a chord and then releases", () => {
  const tracker = new GestureTracker();
  assert.equal(tracker.update([hand({ palm: true, pinch: 0.2 })], 0).length, 0);
  const chord = tracker.update([hand({ palm: true, pinch: 0.2 })], 500);
  assert.equal(chord[0].type, "chord_on");
  assert.ok(chord[0].midis.length >= 2);
  const off = tracker.update([hand({ palm: false, pinch: 0.2 })], 800);
  assert.equal(off[0].type, "chord_off");
});

test("losing the hand releases a held note", () => {
  const tracker = new GestureTracker();
  tracker.update([hand({ pinch: 0.02 })], 100);
  const lost = tracker.update([null], 400);
  assert.equal(lost[0].type, "note_off");
});
