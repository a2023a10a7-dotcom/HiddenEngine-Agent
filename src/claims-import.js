// Imports claims returned by an AI assistant (research/claims-import.json) into
// project.json, but only those whose quote is found verbatim in the source text.
// No dependencies. Usage: PROJECT_ID=<folder> node src/claims-import.js
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const id = process.env.PROJECT_ID;
if (!id || !/^[a-z0-9-]+$/.test(id)) { console.error("Set PROJECT_ID to a valid project folder name."); process.exit(1); }
const dir = path.join("production", "projects", id);
const projectPath = path.join(dir, "project.json");
const readJson = async (p, what) => { try { return JSON.parse(await readFile(p, "utf8")); } catch (e) { console.error("ERROR cannot read " + what + ": " + e.message); process.exit(1); } };
const project = await readJson(projectPath, "project.json");
let incoming = await readJson(path.join(dir, "research", "claims-import.json"), "research/claims-import.json");
if (!Array.isArray(incoming)) { console.error("ERROR claims-import.json must be a JSON array."); process.exit(1); }

const CLASSES = new Set(["verified", "attributed", "estimated", "analysis"]);
const fold = s => String(s || "").normalize("NFKC").toLowerCase()
  .replace(/[\u2018\u2019\u201B\u2032]/g, "'").replace(/[\u201C\u201D\u201E\u2033]/g, '"')
  .replace(/[\u2010-\u2015\u2212]/g, "-").replace(/\s+/g, " ").trim();
const numNorm = s => fold(s).replace(/(\d),(?=\d)/g, "$1").replace(/%/g, " percent ");
const numTokens = s => numNorm(s).match(/\d+(?:\.\d+)?/g) || [];
const numWords = s => numNorm(s).match(/\b(percent|million|billion|trillion|thousand)\b/g) || [];
const subsetOf = (a, b) => { const set = new Set(b); return a.filter(x => !set.has(x)); };

project.research = project.research || {};
project.research.claims = project.research.claims || [];
const sources = new Map((project.research.sources || []).map(s => [s.id, s]));
const textCache = new Map();
async function sourceText(sid) {
  if (textCache.has(sid)) return textCache.get(sid);
  let text = "";
  try { text = await readFile(path.join(dir, "research", "manual-text", sid + ".txt"), "utf8"); } catch {}
  const s = sources.get(sid);
  if (s?.snapshotPath) { try { text += "\n" + (JSON.parse(await readFile(path.join(dir, s.snapshotPath), "utf8")).extractedText || ""); } catch {} }
  const folded = fold(text); textCache.set(sid, folded); return folded;
}

let next = Math.max(0, ...project.research.claims.map(c => Number((String(c.id).match(/^CLM-(\d+)$/) || [])[1]) || 0)) + 1;
const existingTexts = new Set(project.research.claims.map(c => fold(c.text)));
const accepted = [], rejected = [];
const reject = (i, c, why) => rejected.push({ index: i, sourceId: c?.sourceId || null, text: c?.text || null, reason: why });

for (const [i, c] of incoming.entries()) {
  if (!c || typeof c !== "object") { reject(i, null, "not an object"); continue; }
  const text = String(c.text || "").trim();
  const cls = c.classification;
  const sids = Array.isArray(c.sourceIds) && c.sourceIds.length ? c.sourceIds : (c.sourceId ? [c.sourceId] : []);
  if (!text) { reject(i, c, "text is empty"); continue; }
  if (!CLASSES.has(cls)) { reject(i, c, "classification must be one of: " + [...CLASSES].join(", ")); continue; }
  if (!sids.length || sids.some(s => !sources.has(s))) { reject(i, c, "unknown or missing source id"); continue; }
  if (existingTexts.has(fold(text))) { reject(i, c, "duplicate of an existing claim"); continue; }
  if (cls === "attributed" && !String(c.attribution || "").trim()) { reject(i, c, "attributed claim needs attribution"); continue; }
  if (cls === "estimated" && !String(c.caveat || "").trim()) { reject(i, c, "estimated claim needs caveat"); continue; }
  const row = { id: "CLM-" + String(next).padStart(3, "0"), text, classification: cls, sourceIds: sids };
  if (cls === "analysis") {
    if (!String(c.reasoning || "").trim()) { reject(i, c, "analysis claim needs reasoning"); continue; }
    const pool = (await Promise.all(sids.map(sourceText))).join(" ");
    const missing = subsetOf(numTokens(text), numTokens(pool));
    if (missing.length) { reject(i, c, "analysis contains numbers not found in its sources: " + missing.join(", ")); continue; }
    row.reasoning = String(c.reasoning).trim();
  } else {
    const quote = String(c.quote || "").trim();
    if (quote.length < 40 || quote.length > 400) { reject(i, c, "quote must be 40 to 400 characters"); continue; }
    if (/\.\.\.|\u2026/.test(quote)) { reject(i, c, "quote contains an ellipsis; it must be contiguous"); continue; }
    let foundIn = null;
    for (const sid of sids) if ((await sourceText(sid)).includes(fold(quote))) { foundIn = sid; break; }
    if (!foundIn) { reject(i, c, "quote was NOT found verbatim in the source text"); continue; }
    const badNums = subsetOf(numTokens(text), numTokens(quote));
    const badWords = subsetOf(numWords(text), numWords(quote));
    if (badNums.length || badWords.length) { reject(i, c, "claim text has figures not in the quote: " + [...badNums, ...badWords].join(", ")); continue; }
    row.passageQuote = quote;
    row.passageReference = "verbatim passage matched in " + foundIn + ": \u201C" + quote.slice(0, 120) + (quote.length > 120 ? "\u2026" : "") + "\u201D";
    row.passageMatchedSourceId = foundIn;
    if (cls === "attributed") row.attribution = String(c.attribution).trim();
    if (cls === "estimated") row.caveat = String(c.caveat).trim();
  }
  if (c.confidence) row.confidence = c.confidence;
  row.importedAt = new Date().toISOString();
  next++; existingTexts.add(fold(text)); accepted.push(row);
}

project.research.claims.push(...accepted);
const at = new Date().toISOString();
project.research.researchLog = [...(project.research.researchLog || []), { at, action: "claims_import", received: incoming.length, accepted: accepted.length, rejected: rejected.length }];
if (accepted.length) project.research.status = "claims_imported";
project.updatedAt = at;
await writeFile(projectPath, JSON.stringify(project, null, 2) + "\n");
await writeFile(path.join(dir, "research", "claims-import-report.json"), JSON.stringify({ at, received: incoming.length, accepted: accepted.map(a => a.id), rejected }, null, 2) + "\n");
console.log("Received " + incoming.length + " | accepted " + accepted.length + " | rejected " + rejected.length);
for (const r of rejected) console.log("REJECTED #" + r.index + ": " + r.reason + (r.text ? " | " + String(r.text).slice(0, 80) : ""));
if (rejected.length || !accepted.length) process.exitCode = 1;
