// Compiles SCRIPT-DRAFT.json (from script-writer.js) into script.json with beats,
// the input format of the renderer and of src/script-gate.js. No dependencies.
// Usage: PROJECT_ID=<folder> node src/script-compile.js   (FORCE=1 overwrites an existing script.json)
import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";

const id = process.env.PROJECT_ID;
if (!id || !/^[a-z0-9-]+$/.test(id)) { console.error("Set PROJECT_ID to a valid project folder name."); process.exit(1); }
const dir = path.join("production", "projects", id);
const read = async name => { try { return JSON.parse(await readFile(path.join(dir, name), "utf8")); } catch (e) { console.error("ERROR cannot read " + name + ": " + e.message + ". Run the earlier stages first."); process.exit(1); } };
const draft = await read("SCRIPT-DRAFT.json");
const project = await read("project.json");
const byId = new Map((project.research?.claims || []).map(c => [c.id, c]));

if (draft.projectId !== id) { console.error("ERROR SCRIPT-DRAFT.json belongs to another project."); process.exit(1); }
if (draft.status === "blocked") { console.error("ERROR the draft is blocked: " + JSON.stringify(draft.issues)); process.exit(1); }
const target = path.join(dir, "script.json");
const exists = await access(target).then(() => true).catch(() => false);
if (exists && process.env.FORCE !== "1") { console.error("ERROR script.json already exists. Set FORCE=1 to overwrite it."); process.exit(1); }

const endSentence = s => { const t = String(s || "").replace(/\s+/g, " ").trim(); return /[.!?]$/.test(t) ? t : t + "."; };
const scenes = [];
for (const s of draft.scenes || []) {
  if (!s.narrationBlocks?.length) continue;
  const act = String(s.act || s.id).toUpperCase();
  const beats = s.narrationBlocks.map((b, i) => {
    const narration = endSentence(b.narrationText);
    const hasFigure = /\d/.test(narration);
    const claim = byId.get(b.claimId);
    // Visual variety rule: analysis -> text card; claims with a verbatim passage alternate
    // between a figure card and a source-document excerpt; the rest fall back to figure or text.
    let visual;
    if (claim?.classification === "analysis") visual = { type: "kinetic_text" };
    else if (claim?.passageQuote && (!hasFigure || i % 2 === 1)) visual = { type: "source_excerpt" };
    else if (hasFigure) visual = { type: "data_graphic", data_claim_ids: [b.claimId] };
    else visual = { type: "kinetic_text" };
    return { id: s.id + "-B" + (i + 1), kind: "claim", narration, claim_ids: [b.claimId], visual, on_screen_text: act };
  });
  scenes.push({
    id: s.id,
    title: act,
    subtitle: String(s.editorialGoal || "").slice(0, 120),
    keywords: act.split(/\s+/).slice(0, 4),
    narration: beats.map(b => b.narration).join(" "),
    beats
  });
}
if (!scenes.length) { console.error("ERROR no scene has narration blocks."); process.exit(1); }
const script = {
  schema: "beats-1",
  title: project.topic || id,
  language: draft.language || project.language || "en",
  target_duration_minutes: Math.round(((draft.targetDurationSeconds || project.targetDurationSeconds || 480) / 60) * 10) / 10,
  scenes
};
await writeFile(target, JSON.stringify(script, null, 2) + "\n");
console.log("Wrote " + target + " with " + scenes.length + " scenes and " + scenes.reduce((n, s) => n + s.beats.length, 0) + " beats.");
