import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { createThreeDScene } from "./three-dimensional.mjs";
import {
  createBarChart,
  createTimeline,
  createArchitectureDiagram,
  createExplodedDiagram
} from "./graphics.mjs";

const OUTPUT_SCALE = 4; // 8K PNG (7680x4320) from a 1920x1080 vector layout.

const makers = {
  bar: createBarChart,
  timeline: createTimeline,
  architecture: createArchitectureDiagram,
  exploded: createExplodedDiagram,
  engine3d: createThreeDScene,
  technical3d: createThreeDScene
};

export function renderSpec(spec) {
  const make = makers[spec.type];
  if (!make) throw new Error("Unknown type: " + spec.type);

  const svg = make(spec);
  const image = new Resvg(svg, {
    fitTo: { mode: "zoom", value: OUTPUT_SCALE },
    font: { loadSystemFonts: true, defaultFontFamily: "DejaVu Sans" }
  }).render();

  return { svg, png: image.asPng(), width: image.width, height: image.height };
}

const [, , input, name] = process.argv;

if (input) {
  if (!name || !/^[a-z0-9_-]+$/i.test(name)) {
    throw new Error("Usage: node render.mjs <input.json> <safe-name>");
  }
  const spec = JSON.parse(readFileSync(input, "utf8"));
  const { svg, png, width, height } = renderSpec(spec);
  mkdirSync("output", { recursive: true });
  writeFileSync(`output/${name}.svg`, svg);
  writeFileSync(`output/${name}.png`, png);
  console.log(`${name}.png ${width}x${height}`);
}
