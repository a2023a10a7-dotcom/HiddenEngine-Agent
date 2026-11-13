// HiddenEngine script v2 validator: no dependencies.
// Usage: PROJECT_ID=<folder> node src/validate-script-v2.js
import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

const PROJECT_ID = process.env.PROJECT_ID || process.argv[2];
if (!PROJECT_ID) { console.error("PROJECT_ID is missing."); process.exit(2); }
const file = path.join("production", "projects", PROJECT_ID, "script.v2.json");
const errors = [], warnings = [];
const err = (where, msg) => errors.push("[" + where + "] " + msg);
const warn = (where, msg) => warnings.push("[" + where + "] " + msg);

const VISUALS = new Set(["data_graphic", "map", "diagram", "timeline", "kinetic_text", "stock_illustrative"]);
const DATA_VISUALS = new Set(["data_graphic", "map", "timeline"]);
const CLAIM_TYPES = new Set(["fact", "number", "attributed", "estimate", "analysis"]);
const NUMERIC = /\d|\b(percent|per cent|million|billion|trillion|thousand|hundred|dozens?)\b/i;
const ABSOLUTE = /\b(first|largest|biggest|only|most|never|always|every|all|leading|dominant|dominates|overtook|surpass(?:ed|es)?|record|unprecedented)\b/i;
const words = s => String(s || "").trim().split(/\s+/).filter(Boolean).length;
const str = v => typeof v === "string" && v.trim().length > 0;
const cell = s => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

let doc;
try { doc = JSON.parse(await readFile(file, "utf8")); }
catch (e) { console.error("Cannot read or parse " + file + ": " + e.message); process.exit(2); }

if (doc.schema_version !== 2) err("root", "schema_version must be 2.");
if (!str(doc.title)) err("root", "title is missing.");
if (!(Number(doc.target_duration_minutes) > 0)) err("root", "target_duration_minutes must be a positive number.");

// Sources
const sources = new Map();
for (const s of doc.sources || []) {
  if (!str(s.id)) { err("source", "a source has no id."); continue; }
  if (sources.has(s.id)) err("source " + s.id, "duplicate id.");
  sources.set(s.id, s);
  if (!str(s.title)) err("source " + s.id, "title is missing.");
  if (!str(s.publisher)) err("source " + s.id, "publisher is missing.");
  if (!str(s.url) || !s.url.startsWith("https://")) err("source " + s.id, "url must start with https://");
  if (!["primary", "secondary"].includes(s.type)) err("source " + s.id, "type must be primary or secondary.");
  if (!str(s.accessed)) err("source " + s.id, "accessed (date you opened it) is missing.");
}
if (!sources.size) err("root", "no sources.");

// Claims
const claims = new Map();
for (const c of doc.claims || []) {
  const w = "claim " + (c.id || "?");
  if (!str(c.id)) { err("claim", "a claim has no id."); continue; }
  if (claims.has(c.id)) err(w, "duplicate id.");
  claims.set(c.id, c);
  if (!str(c.text)) err(w, "text is missing.");
  if (!CLAIM_TYPES.has(c.type)) { err(w, "type must be one of: " + [...CLAIM_TYPES].join(", ")); continue; }
  if (c.type !== "analysis") {
    if (!Array.isArray(c.source_ids) || !c.source_ids.length) err(w, "needs at least one source_id.");
    for (const id of c.source_ids || []) if (!sources.has(id)) err(w, "unknown source_id: " + id);
  }
  if (c.type === "number") {
    if (c.value === undefined || c.value === "") err(w, "number claim needs value.");
    if (!str(c.unit)) err(w, "number claim needs unit.");
    if (!str(c.as_of)) err(w, "number claim needs as_of (year or date the figure refers to).");
    const onlySecondary = (c.source_ids || []).every(id => sources.get(id)?.type === "secondary");
    if (onlySecondary) warn(w, "number backed only by secondary sources; find the primary source.");
  }
  if ((c.type === "attributed" || c.type === "estimate") && !str(c.attributed_to)) err(w, c.type + " claim needs attributed_to (who says it).");
}

// Scenes and beats
const used = new Set(), beatIds = new Set();
let totalWords = 0, beatCount = 0, stockCount = 0;
if (!Array.isArray(doc.scenes) || !doc.scenes.length) err("root", "no scenes.");
for (const sc of doc.scenes || []) {
  const sw = "scene " + (sc.id || "?");
  if (!str(sc.id)) err("scene", "a scene has no id.");
  if (!Array.isArray(sc.beats) || !sc.beats.length) { err(sw, "no beats."); continue; }
  for (const b of sc.beats) {
    const w = "beat " + (b.id || "?");
    beatCount++;
    if (!str(b.id)) err(w, "beat has no id.");
    else if (beatIds.has(b.id)) err(w, "duplicate id."); else beatIds.add(b.id);
    if (!str(b.narration)) { err(w, "narration is missing."); continue; }
    const n = words(b.narration); totalWords += n;
    if (n > 90) err(w, "narration too long (" + n + " words). Split it into two beats.");
    else if (n > 60) warn(w, "narration is long (" + n + " words).");
    const kind = b.kind || "claim";
    const ids = Array.isArray(b.claim_ids) ? b.claim_ids : [];
    for (const id of ids) { if (!claims.has(id)) err(w, "unknown claim_id: " + id); else used.add(id); }
    if (kind === "claim") {
      if (!ids.length) err(w, "claim beat has no claim_ids.");
      if (NUMERIC.test(b.narration) && !ids.some(id => claims.get(id)?.type === "number"))
        err(w, "narration contains a number but no claim of type number is linked.");
    } else if (kind === "transition") {
      if (NUMERIC.test(b.narration)) err(w, "transition beats may not contain numbers.");
      if (ABSOLUTE.test(b.narration)) err(w, "transition beats may not contain absolute or superlative wording.");
    } else err(w, "kind must be claim or transition.");

    const v = b.visual || {};
    if (!VISUALS.has(v.type)) { err(w, "visual.type must be one of: " + [...VISUALS].join(", ")); continue; }
    if (DATA_VISUALS.has(v.type)) {
      const d = v.data_claim_ids;
      if (!Array.isArray(d) || !d.length) err(w, v.type + " needs visual.data_claim_ids.");
      for (const id of d || []) if (!claims.has(id) || !["number", "fact"].includes(claims.get(id).type)) err(w, "data_claim_ids must reference number or fact claims: " + id);
    }
    if (v.type === "diagram" && !str(v.description)) err(w, "diagram needs visual.description.");
    if (v.type === "kinetic_text" && !str(b.on_screen_text)) err(w, "kinetic_text needs on_screen_text.");
    if (v.type === "stock_illustrative") {
      stockCount++;
      if (!str(v.query)) err(w, "stock_illustrative needs visual.query.");
      if (v.illustrative !== true) err(w, "stock_illustrative needs visual.illustrative = true (it will be labeled as non-evidence).");
    }
    if (str(b.on_screen_text) && words(b.on_screen_text) > 12) warn(w, "on_screen_text is longer than 12 words.");
  }
}
if (beatCount && stockCount / beatCount > 0.25) err("root", "stock visuals are " + Math.round(100 * stockCount / beatCount) + "% of beats; the limit is 25%.");
for (const id of claims.keys()) if (!used.has(id)) warn("claim " + id, "never used in any beat.");

const minutes = totalWords / 150;
const target = Number(doc.target_duration_minutes) || 0;
if (target && Math.abs(minutes - target) / target > 0.2) warn("root", "estimated narration is " + minutes.toFixed(1) + " min vs target " + target + " min.");

// Human review sheet
const out = [];
out.push("# Fact-check sheet: " + (doc.title || PROJECT_ID), "");
out.push("**Status:** " + (errors.length ? "BLOCKED (" + errors.length + " errors)" : "PASSED automatic checks; human review still required"), "");
out.push("Beats: " + beatCount + " | Estimated narration: " + minutes.toFixed(1) + " min | Stock visuals: " + stockCount, "");
if (errors.length) out.push("## Errors", "", ...errors.map(e => "- " + e), "");
if (warnings.length) out.push("## Warnings", "", ...warnings.map(w => "- " + w), "");
const row = c => "| " + cell(c.id) + " | " + cell(c.text) + " | " + cell(c.type === "number" ? c.value + " " + (c.unit || "") + " (as of " + (c.as_of || "?") + ")" : (c.attributed_to || "")) + " | " + cell((c.source_ids || []).map(id => sources.get(id) ? sources.get(id).publisher + " " + sources.get(id).url : id).join(" ; ")) + " |";
const head = ["| ID | Claim | Value / attributed to | Source |", "|---|---|---|---|"];
const nums = [...claims.values()].filter(c => c.type === "number");
const rest = [...claims.values()].filter(c => c.type !== "number");
out.push("## Numbers (check each against its source)", "", ...head, ...nums.map(row), "");
out.push("## Other claims", "", ...head, ...rest.map(row), "");
out.push("## Human approval checklist", "",
  "- [ ] Every number matches its source page",
  "- [ ] Every attributed claim names the right person or organization",
  "- [ ] No sentence says more than its source says",
  "- [ ] Names and terms are pronounceable by the voice",
  "- [ ] Rights and licenses reviewed", "");
const report = out.join("\n");
await mkdir(path.join("dist", PROJECT_ID), { recursive: true });
await writeFile(path.join("dist", PROJECT_ID, "FACT-CHECK-SHEET.md"), report);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report + "\n");

console.log("Errors: " + errors.length + " | Warnings: " + warnings.length);
for (const e of errors) console.log("ERROR " + e);
for (const w of warnings) console.log("WARN  " + w);
process.exit(errors.length ? 1 : 0);
