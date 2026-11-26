import test from "node:test";
import assert from "node:assert/strict";
import { scoreVisualCandidate } from "../src/visual-relevance.js";

test("rejects a generic one-word stock match", () => {
  const result = scoreVisualCandidate({
    query: "China automated factory assembly line production",
    tags: "factory, industrial, business, workers"
  });
  assert.equal(result.accepted, false);
});

test("accepts multiple specific query matches", () => {
  const result = scoreVisualCandidate({
    query: "Shenzhen electronics manufacturing workers",
    tags: "Shenzhen, electronics, manufacturing, circuit board",
    requirementGroups: [["electronics", "circuit board"], ["industrial", "factory"]]
  });
  assert.equal(result.accepted, true);
  assert.ok(result.matchedTokens.length >= 2);
  assert.ok(result.matchedGroups[0]);
});

test("rejects candidates unrelated to the required visual subject", () => {
  const result = scoreVisualCandidate({
    query: "semiconductor wafer fabrication",
    tags: "solar panel, renewable energy, landscape",
    requirementGroups: [["chip", "semiconductor", "wafer"]]
  });
  assert.equal(result.accepted, false);
});

test("allows a single unusually specific exact term", () => {
  const result = scoreVisualCandidate({
    query: "photolithography",
    tags: "photolithography, semiconductor cleanroom"
  });
  assert.equal(result.accepted, true);
});
