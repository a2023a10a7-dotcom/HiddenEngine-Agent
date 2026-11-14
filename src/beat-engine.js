// Beat Engine: compiles validated Script V2 beats into renderer-ready scene units.
// Each beat remains an independently traceable production unit.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const valid = value => typeof value === "string" && value.trim().length > 0;
const slug = value => String(value || "").replace(/[^a-zA-Z0-9_-]/g, "-");

function visualForBeat(beat, claimsById) {
  const source = beat.visual || {};
  const type = source.type;
  const linked = (beat.claim_ids || []).map(id => claimsById.get(id)).filter(Boolean);
  if (type === "data_graphic") {
    const dataIds = source.data_claim_ids || [];
    const claim = dataIds.map(id => claimsById.get(id)).find(Boolean) || linked.find(c => c.type === "number");
    return {
      type: "metric",
      source_label: "DOCUMENTED FIGURE" + (claim?.as_of ? " • " + claim.as_of : ""),
      value: claim ? String(claim.value) + (claim.unit ? " " + claim.unit : "") : "DATA",
      detail: claim?.text || source.description || "See linked evidence in the fact-check sheet."
    };
  }
  if (type === "diagram") return { type, description: source.description };
  if (type === "timeline") return { type, source_label: source.source_label || "DOCUMENTED TIMELINE", events: source.events || [] };
  if (type === "map") return { type, source_label: source.source_label || "DOCUMENTED MAP", points: source.points || [] };
  if (type === "kinetic_text") return { type, text: beat.on_screen_text || "" };
  if (type === "stock_illustrative") return { type, illustrative: true, source_label: "ILLUSTRATIVE • NOT EVIDENCE" };
  throw new Error("Unsupported beat visual type '" + type + "' for beat " + beat.id);
}

export function compileScriptV2(doc) {
  if (!doc || doc.schema_version !== 2 || !Array.isArray(doc.scenes)) {
    throw new Error("Beat Engine expects a validated Script V2 document (schema_version: 2).");
  }
  const claims = new Map((doc.claims || []).map(claim => [claim.id, claim]));
  const scenes = [];
  const manifest = [];
  for (const [sceneIndex, scene] of doc.scenes.entries()) {
    if (!Array.isArray(scene.beats)) throw new Error("Scene " + (scene.id || sceneIndex + 1) + " has no beats array.");
    for (const [beatIndex, beat] of scene.beats.entries()) {
      if (!valid(beat.id) || !valid(beat.narration)) throw new Error("Beat " + (scene.id || sceneIndex + 1) + "/" + beatIndex + " is missing id or narration.");
      const visual = visualForBeat(beat, claims);
      const query = beat.visual_query || beat.visual?.query || [scene.title, beat.on_screen_text, beat.visual?.description].filter(Boolean).join(" ");
      scenes.push({
        id: slug(beat.id),
        source_scene_id: scene.id,
        source_beat_id: beat.id,
        title: scene.title || beat.id,
        subtitle: beat.on_screen_text || beat.visual?.description || "",
        narration: beat.narration,
        visual,
        visual_query: query
      });
      manifest.push({
        render_scene: scenes.length,
        source_scene_id: scene.id,
        source_beat_id: beat.id,
        kind: beat.kind || "claim",
        claim_ids: beat.claim_ids || [],
        visual_type: beat.visual?.type || "unknown",
        narration_words: beat.narration.trim().split(/\s+/).filter(Boolean).length
      });
    }
  }
  if (!scenes.length) throw new Error("Script V2 contains no beats to render.");
  return {
    title: doc.title,
    language: doc.language || "en",
    voice: doc.voice || "en-us",
    target_duration_minutes: doc.target_duration_minutes,
    scenes,
    beat_manifest: manifest
  };
}

async function main() {
  const projectId = process.env.PROJECT_ID || process.argv[2];
  if (!projectId || !/^[a-z0-9_-]+$/.test(projectId)) throw new Error("PROJECT_ID is missing or invalid.");
  const root = path.join("production", "projects", projectId);
  const input = path.join(root, "script.v2.json");
  const output = path.join("dist", projectId);
  const doc = JSON.parse(await readFile(input, "utf8"));
  const compiled = compileScriptV2(doc);
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "render-script.json"), JSON.stringify(compiled, null, 2) + "\n");
  await writeFile(path.join(output, "BEAT-MANIFEST.json"), JSON.stringify({
    schema_version: 1,
    source: "script.v2.json",
    beat_count: compiled.scenes.length,
    beats: compiled.beat_manifest
  }, null, 2) + "\n");
  console.log("Beat Engine compiled " + compiled.scenes.length + " beats into renderer-ready units.");
}
if (process.argv[1] && import.meta.url === new URL("file://" + path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error("Beat Engine failed:", error); process.exit(1); });
}
