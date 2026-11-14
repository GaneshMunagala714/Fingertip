import assert from "node:assert/strict";
import test from "node:test";
import { formatDisplay, isCallableNumber, toE164 } from "./numbers.ts";

test("formats a US number as it is typed", () => {
  assert.equal(formatDisplay("+1", "555"), "(555");
  assert.equal(formatDisplay("+1", "5550100"), "(555) 010-0");
  assert.equal(formatDisplay("+1", "5550100199"), "(555) 010-0199");
});

test("requires a full number before a call can be placed", () => {
  assert.equal(isCallableNumber(toE164("+1", "555")), false);
  assert.equal(isCallableNumber(toE164("+1", "5550100199")), true);
});
