import test from "node:test";
import assert from "node:assert/strict";
import { extractJson, validateVisualDecision } from "../src/ai-visual-selection.js";

test("parses JSON wrapped in a markdown fence", () => {
  assert.deepEqual(extractJson('```json\n{"selectedIndex":1}\n```'), { selectedIndex: 1 });
});

test("accepts a visually approved candidate above the confidence threshold", () => {
  const result = validateVisualDecision({ selectedIndex: 1, confidence: 0.91, rationale: "The visible object is a battery cell production line.", visibleSubject: "Battery cells" }, 3);
  assert.equal(result.accepted, true);
  assert.equal(result.selectedIndex, 1);
});

test("rejects low-confidence candidate choices", () => {
  const result = validateVisualDecision({ selectedIndex: 0, confidence: 0.5, rationale: "Only vaguely related.", visibleSubject: "Factory" }, 2);
  assert.equal(result.accepted, false);
});

test("allows the visual director to reject every candidate", () => {
  const result = validateVisualDecision({ selectedIndex: -1, confidence: 0.2, rationale: "None shows the named product.", visibleSubject: "Unrelated stock imagery" }, 4);
  assert.equal(result.accepted, false);
});

test("rejects out-of-range candidate indices", () => {
  assert.throws(() => validateVisualDecision({ selectedIndex: 4, confidence: 0.99 }, 4), /invalid candidate index/);
});
