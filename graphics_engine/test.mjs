import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { renderSpec } from "./render.mjs";
import { createTimeline } from "./graphics.mjs";

const load = file =>
  JSON.parse(readFileSync(new URL(`./data/${file}`, import.meta.url), "utf8"));

function check(name, spec) {
  const { png, width, height } = renderSpec(spec);
  assert.equal(width, 3840, `${name}: width`);
  assert.equal(height, 2160, `${name}: height`);
  assert.ok(png.length > 5000, `${name}: PNG too small`);
  assert.equal(png[0], 0x89, `${name}: PNG signature`);
  console.log(`OK ${name} ${width}x${height} (${png.length} bytes)`);
}

const timeline = load("timeline.json");

check("timeline", timeline);
check("bar", load("bar.json"));
check("architecture", load("architecture.json"));
check("timeline-1-event", { ...timeline, events: timeline.events.slice(0, 1) });
check("timeline-8-events", {
  ...timeline,
  events: Array.from({ length: 8 }, (_, i) => ({
    date: String(2000 + i),
    label: `A deliberately long event label number ${i + 1}`
  }))
});

const oneEventSvg = createTimeline({
  title: "One event",
  events: [{ date: "2020", label: "A very long label that must be shortened" }]
});
assert.match(oneEventSvg, /A very long label that m…/);

assert.throws(
  () => renderSpec({ type: "bar", title: "x", items: [{ label: "a", value: -1 }] }),
  /Invalid chart value/
);
assert.throws(
  () => renderSpec({ type: "timeline", title: "x", events: [] }),
  /at least one/
);
assert.throws(
  () => renderSpec({
    type: "architecture", title: "x",
    nodes: [{ id: "a", label: "A" }, { id: "a", label: "Duplicate" }]
  }),
  /unique/
);

console.log("All tests passed");
