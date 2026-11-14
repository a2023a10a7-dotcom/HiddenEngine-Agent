// Imports real source URLs (found by a human or an AI assistant with web access)
// from research/sources-import.json into project.json. No dependencies.
// Usage: PROJECT_ID=<folder> node src/sources-import.js
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const id = process.env.PROJECT_ID;
if (!id || !/^[a-z0-9-]+$/.test(id)) { console.error("Set PROJECT_ID to a valid project folder name."); process.exit(1); }
const dir = path.join("production", "projects", id);
const readJson = async (p, what) => { try { return JSON.parse(await readFile(p, "utf8")); } catch (e) { console.error("ERROR cannot read " + what + ": " + e.message); process.exit(1); } };
const projectPath = path.join(dir, "project.json");
const project = await readJson(projectPath, "project.json");
const incoming = await readJson(path.join(dir, "research", "sources-import.json"), "research/sources-import.json");
if (!Array.isArray(incoming)) { console.error("ERROR sources-import.json must be a JSON array."); process.exit(1); }

const TYPES = new Set(["primary_filing", "annual_report", "regulatory_filing", "court_record", "official_dataset", "company_statement", "technical_paper", "original_interview", "official_transcript", "secondary_report", "analysis"]);
const str = v => typeof v === "string" && v.trim().length > 0;
function cleanUrl(value) {
  try {
    const u = new URL(String(value).trim());
    if (u.protocol !== "https:" || u.username || u.password) return null;
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h.endsWith(".localhost") || /^\d+\.\d+\.\d+\.\d+$/.test(h)) return null;
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch { return null; }
}

project.research = project.research || {};
project.research.sources = project.research.sources || [];
const known = new Set(project.research.sources.map(s => cleanUrl(s.url)).filter(Boolean));
let next = Math.max(0, ...project.research.sources.map(s => Number((String(s.id).match(/^SRC-(\d+)$/) || [])[1]) || 0)) + 1;
const accepted = [], rejected = [], notes = [];
const reject = (i, s, why) => rejected.push({ index: i, url: s?.url || null, reason: why });

for (const [i, s] of incoming.entries()) {
  if (!s || typeof s !== "object") { reject(i, null, "not an object"); continue; }
  if (!str(s.publisher)) { reject(i, s, "publisher is missing"); continue; }
  if (!str(s.title)) { reject(i, s, "title is missing"); continue; }
  if (!TYPES.has(s.type)) { reject(i, s, "type must be one of: " + [...TYPES].join(", ")); continue; }
  const url = cleanUrl(s.url);
  if (!url) { reject(i, s, "url must be a public https URL"); continue; }
  if (/(^|\.)news\.google\.com$/i.test(new URL(url).hostname)) { reject(i, s, "Google News links are redirects; use the publisher's own page"); continue; }
  if (known.has(url)) { reject(i, s, "duplicate url"); continue; }
  const row = { id: "SRC-" + String(next).padStart(3, "0"), publisher: s.publisher.trim(), title: s.title.trim(), url, publishedAt: str(s.publishedAt) ? s.publishedAt.trim() : null, accessedAt: new Date().toISOString(), type: s.type, notes: str(s.notes) ? s.notes.trim() : "", addedBy: "sources-import" };
  if (!row.publishedAt) notes.push(row.id + ": no publishedAt; add it if known");
  if (/\.pdf(\?|$)/i.test(url)) notes.push(row.id + ": PDF. The ingest stage cannot read PDFs; paste the needed text into research/manual-text/" + row.id + ".txt");
  next++; known.add(url); accepted.push(row);
}

project.research.sources.push(...accepted);
const at = new Date().toISOString();
project.research.researchLog = [...(project.research.researchLog || []), { at, action: "sources_import", received: incoming.length, accepted: accepted.length, rejected: rejected.length }];
project.updatedAt = at;
await writeFile(projectPath, JSON.stringify(project, null, 2) + "\n");
await mkdir(path.join(dir, "research"), { recursive: true });
await writeFile(path.join(dir, "research", "sources-import-report.json"), JSON.stringify({ at, received: incoming.length, accepted: accepted.map(a => a.id), rejected, notes }, null, 2) + "\n");
console.log("Received " + incoming.length + " | accepted " + accepted.length + " | rejected " + rejected.length);
for (const a of accepted) console.log("ADDED " + a.id + " [" + a.type + "] " + a.url);
for (const r of rejected) console.log("REJECTED #" + r.index + ": " + r.reason + (r.url ? " | " + r.url : ""));
for (const n of notes) console.log("NOTE " + n);
if (rejected.length || !accepted.length) process.exitCode = 1;
