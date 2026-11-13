// HiddenEngine script gate: checks script.json (beats) against the project.json evidence ledger.
// No dependencies. Usage: PROJECT_ID=<folder> node src/script-gate.js
import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

const id = process.env.PROJECT_ID || process.argv[2];
if (!id || !/^[a-z0-9-]+$/.test(id)) { console.error("Set PROJECT_ID to a valid project folder name."); process.exit(1); }
const dir = path.join("production", "projects", id);
const errors = [], warnings = [];
const err = (w, m) => errors.push("[" + w + "] " + m);
const warn = (w, m) => warnings.push("[" + w + "] " + m);

async function load(name) {
  try { return JSON.parse(await readFile(path.join(dir, name), "utf8")); }
  catch (e) { console.error("ERROR cannot read " + path.join(dir, name) + ": " + e.message); process.exit(1); }
}
const project = await load("project.json");
const script = await load("script.json");

const ELIGIBLE = new Set(["verified", "attributed", "estimated", "analysis"]);
const VISUALS = new Set(["data_graphic", "map", "diagram", "timeline", "kinetic_text", "stock_illustrative"]);
const DATA_VISUALS = new Set(["data_graphic", "map", "timeline"]);
const ABSOLUTE = /\b(first|largest|biggest|only|never|always|leading|dominant|dominates|overtook|surpass(?:ed|es)?|record|unprecedented)\b/i;
const str = v => typeof v === "string" && v.trim().length > 0;
const words = s => String(s || "").trim().split(/\s+/).filter(Boolean).length;
const squash = s => String(s || "").replace(/\s+/g, " ").trim();
const norm = s => String(s || "").toLowerCase().replace(/(\d),(?=\d)/g, "$1").replace(/%/g, " percent ");
const numTokens = s => norm(s).match(/\d+(?:\.\d+)?/g) || [];
const numWords = s => norm(s).match(/\b(percent|million|billion|trillion|thousand)\b/g) || [];
const cell = s => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

const sources = new Map((project.research?.sources || []).map(s => [s.id, s]));
const claims = new Map((project.research?.claims || []).map(c => [c.id, c]));
if (!claims.size) err("ledger", "project.json has no research.claims. Complete the research stage first (documentary:research, then add sourced claims).");
if (!sources.size) err("ledger", "project.json has no research.sources.");

const used = new Set(), rows = [];
let beatCount = 0, stockCount = 0, totalWords = 0;
if (!Array.isArray(script.scenes) || !script.scenes.length) err("script", "script.json has no scenes.");
for (const [si, sc] of (script.scenes || []).entries()) {
  const sw = "scene " + (si + 1);
  if (!Array.isArray(sc.beats) || !sc.beats.length) { err(sw, "no beats. Every scene must be written as beats linked to ledger claims."); continue; }
  const joined = squash(sc.beats.map(b => squash(b.narration)).join(" "));
  if (squash(sc.narration) !== joined) err(sw, "scene.narration must equal the beats joined with single spaces. The renderer speaks scene.narration, so what is spoken must be what was checked.");
  const seen = new Set();
  for (const b of sc.beats) {
    const w = sw + " beat " + (b.id || "?");
    beatCount++;
    if (!str(b.id)) err(w, "beat has no id."); else if (seen.has(b.id)) err(w, "duplicate beat id."); else seen.add(b.id);
    if (!str(b.narration)) { err(w, "narration is missing."); continue; }
    const n = words(b.narration); totalWords += n;
    if (n > 90) err(w, "narration is " + n + " words; split it into two beats."); else if (n > 60) warn(w, "narration is " + n + " words.");
    const kind = b.kind || "claim";
    const ids = Array.isArray(b.claim_ids) ? b.claim_ids : [];
    const linked = [];
    for (const cid of ids) {
      const c = claims.get(cid);
      if (!c) { err(w, "unknown claim_id: " + cid); continue; }
      used.add(cid); linked.push(c);
      if (!ELIGIBLE.has(c.classification)) err(w, "claim " + cid + " is '" + c.classification + "' and cannot be narrated.");
    }
    const text = linked.map(c => c.text).join(" ");
    if (kind === "claim") {
      if (!ids.length) err(w, "claim beat has no claim_ids.");
      const have = new Set(numTokens(text));
      for (const t of new Set(numTokens(b.narration))) if (!have.has(t)) err(w, "the number " + t + " appears in the narration but not in any linked claim.");
      const haveW = new Set(numWords(text));
      for (const t of new Set(numWords(b.narration))) if (!haveW.has(t)) err(w, "the word '" + t + "' appears in the narration but not in any linked claim.");
      if (ABSOLUTE.test(b.narration) && !linked.some(c => ["verified", "attributed"].includes(c.classification)))
        err(w, "absolute or superlative wording needs a linked claim classified verified or attributed.");
    } else if (kind === "transition") {
      if (numTokens(b.narration).length || numWords(b.narration).length) err(w, "transition beats may not contain numbers.");
      if (ABSOLUTE.test(b.narration)) err(w, "transition beats may not contain absolute or superlative wording.");
    } else err(w, "kind must be claim or transition.");

    const v = b.visual || {};
    if (!VISUALS.has(v.type)) err(w, "visual.type must be one of: " + [...VISUALS].join(", "));
    else {
      if (DATA_VISUALS.has(v.type)) {
        if (!Array.isArray(v.data_claim_ids) || !v.data_claim_ids.length) err(w, v.type + " needs visual.data_claim_ids.");
        for (const cid of v.data_claim_ids || []) { const c = claims.get(cid); if (!c || !/\d/.test(c.text)) err(w, "data_claim_ids must reference ledger claims that contain a figure: " + cid); }
      }
      if (v.type === "diagram" && !str(v.description)) err(w, "diagram needs visual.description.");
      if (v.type === "kinetic_text" && !str(b.on_screen_text)) err(w, "kinetic_text needs on_screen_text.");
      if (v.type === "stock_illustrative") {
        stockCount++;
        if (!str(v.query)) err(w, "stock_illustrative needs visual.query.");
        if (v.illustrative !== true) err(w, "stock_illustrative needs visual.illustrative = true (labeled as non-evidence).");
      }
    }
    if (str(b.on_screen_text) && words(b.on_screen_text) > 12) warn(w, "on_screen_text is longer than 12 words.");
    rows.push({ w, b, linked });
  }
}
if (beatCount && stockCount / beatCount > 0.25) err("visuals", "stock visuals are " + Math.round(100 * stockCount / beatCount) + "% of beats; the limit is 25%.");
for (const cid of claims.keys()) if (ELIGIBLE.has(claims.get(cid).classification) && !used.has(cid)) warn("claim " + cid, "eligible but never used in any beat.");
const minutes = totalWords / 150;
const target = Number(script.target_duration_minutes) || (Number(project.targetDurationSeconds) / 60) || 0;
if (target && Math.abs(minutes - target) / target > 0.2) warn("script", "estimated narration is " + minutes.toFixed(1) + " min vs target " + target.toFixed(1) + " min.");

const out = [];
out.push("# Fact-check sheet: " + (script.title || id), "");
out.push("**Status:** " + (errors.length ? "BLOCKED (" + errors.length + " errors)" : "PASSED automatic checks; human review still required"), "");
out.push("Beats: " + beatCount + " | Estimated narration: " + minutes.toFixed(1) + " min | Stock visuals: " + stockCount, "");
if (errors.length) out.push("## Errors", "", ...errors.map(e => "- " + e), "");
if (warnings.length) out.push("## Warnings", "", ...warnings.map(w => "- " + w), "");
out.push("## Every spoken sentence with its evidence", "", "| Beat | Narration | Claims | Sources |", "|---|---|---|---|");
for (const { w, b, linked } of rows) {
  const cl = linked.map(c => c.id + " (" + c.classification + "): " + c.text).join("<br>");
  const sr = [...new Set(linked.flatMap(c => c.sourceIds || []))].map(sid => { const s = sources.get(sid); return s ? s.publisher + " " + s.url : sid + " (missing)"; }).join("<br>");
  out.push("| " + cell(w) + " | " + cell(b.narration) + " | " + cell(cl) + " | " + cell(sr) + " |");
}
out.push("", "## Human approval checklist", "",
  "- [ ] Each number matches the exact passage in its source",
  "- [ ] Attributed claims name the right speaker or organization",
  "- [ ] No sentence says more than its claim says",
  "- [ ] Names and terms are pronounceable by the voice",
  "- [ ] Rights and licenses reviewed", "");
const report = out.join("\n");
await mkdir(path.join("dist", id), { recursive: true });
await writeFile(path.join("dist", id, "FACT-CHECK-SHEET.md"), report);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report + "\n");
console.log("Errors: " + errors.length + " | Warnings: " + warnings.length);
for (const e of errors) console.log("ERROR " + e);
for (const w of warnings) console.log("WARN  " + w);
process.exit(errors.length ? 1 : 0);
