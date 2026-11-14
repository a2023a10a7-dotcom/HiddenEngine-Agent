import assert from "node:assert/strict";
import { compileScriptV2 } from "../src/beat-engine.js";

const fixture = {
  schema_version: 2,
  title: "Beat Engine fixture",
  language: "en",
  target_duration_minutes: 1,
  claims: [
    { id: "C1", type: "number", value: 42, unit: "percent", as_of: "2026", text: "The measured value was 42 percent." }
  ],
  scenes: [
    {
      id: "SC1",
      title: "Evidence",
      beats: [
        {
          id: "B1",
          narration: "The measured value was 42 percent.",
          claim_ids: ["C1"],
          visual: { type: "data_graphic", data_claim_ids: ["C1"] },
          on_screen_text: "42 percent • 2026"
        },
        {
          id: "B2",
          kind: "transition",
          narration: "But the number needs context.",
          visual: { type: "kinetic_text" },
          on_screen_text: "Context matters"
        }
      ]
    },
    {
      id: "SC2",
      title: "Timeline",
      beats: [
        {
          id: "B3",
          narration: "The next chapter followed.",
          kind: "transition",
          visual: { type: "timeline", events: [{ date: "2026", label: "Review" }] }
        }
      ]
    }
  ]
};

const compiled = compileScriptV2(fixture);
assert.equal(compiled.scenes.length, 3, "every beat becomes one render unit");
assert.deepEqual(compiled.beat_manifest.map(item => item.source_beat_id), ["B1", "B2", "B3"]);
assert.equal(compiled.scenes[0].visual.type, "metric");
assert.equal(compiled.scenes[0].visual.value, "42 percent");
assert.equal(compiled.scenes[0].source_scene_id, "SC1");
assert.equal(compiled.scenes[1].visual.type, "kinetic_text");
assert.equal(compiled.scenes[2].visual.type, "timeline");
assert.throws(() => compileScriptV2({ schema_version: 1, scenes: [] }), /schema_version: 2/);
const nonNumericFixture = structuredClone(fixture);
nonNumericFixture.claims[0].type = "fact";
assert.throws(() => compileScriptV2(nonNumericFixture), /must link at least one numeric claim/);
console.log("Beat Engine tests passed: beat mapping, evidence-linked data graphic, visual adapters, and schema guard.");
