// Builds research/CLAIMS-PACKET.md: the source texts plus strict instructions,
// to be pasted into an AI assistant that returns claims as JSON. No dependencies.
// Usage: PROJECT_ID=<folder> node src/claims-packet.js
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const id = process.env.PROJECT_ID;
if (!id || !/^[a-z0-9-]+$/.test(id)) { console.error("Set PROJECT_ID to a valid project folder name."); process.exit(1); }
const dir = path.join("production", "projects", id);
let project;
try { project = JSON.parse(await readFile(path.join(dir, "project.json"), "utf8")); }
catch (e) { console.error("ERROR cannot read project.json: " + e.message); process.exit(1); }

const PRIMARY = new Set(["primary_filing", "annual_report", "regulatory_filing", "court_record", "official_dataset", "company_statement", "technical_paper", "original_interview", "official_transcript"]);
const MAX_PER = 12000, MAX_TOTAL = 90000;
const sources = project.research?.sources || [];

async function textOf(s) {
  try {
    const t = (await readFile(path.join(dir, "research", "manual-text", s.id + ".txt"), "utf8")).trim();
    if (t.length >= 80) return { text: t, from: "manual text file" };
  } catch {}
  if (!s.snapshotPath) return { reason: "not ingested yet (run stage: ingest)" };
  try {
    const r = JSON.parse(await readFile(path.join(dir, s.snapshotPath), "utf8"));
    if (/news\.google\.com/i.test(r.canonicalUrl || "")) return { reason: "search redirect page, not the publisher page; replace the URL with the real article" };
    if (r.extractionStatus !== "html_text_extracted" || !r.extractedText) return { reason: "no usable text (" + (r.extractionStatus || "unknown") + "); paste the relevant text into research/manual-text/" + s.id + ".txt" };
    return { text: r.extractedText, from: "page snapshot" };
  } catch { return { reason: "snapshot file unreadable" }; }
}

const usable = [], excluded = [];
for (const s of sources) {
  const t = await textOf(s);
  if (t.text) usable.push({ s, ...t }); else excluded.push({ s, reason: t.reason });
}
usable.sort((a, b) => (PRIMARY.has(b.s.type) ? 1 : 0) - (PRIMARY.has(a.s.type) ? 1 : 0));

const out = [];
out.push("# Claims extraction packet: " + (project.topic || id), "");
out.push("## Your task", "",
  "Extract factual claims for a documentary from the SOURCE TEXTS below, and nothing else.", "",
  "Rules:",
  "1. Use ONLY the text in this packet. No outside knowledge, no guessing, no sources that are not listed.",
  "2. One fact per claim.",
  "3. `quote` must be copied VERBATIM and contiguously from the source text (40 to 400 characters). No ellipses, no edits.",
  "4. `text` may say no more than the quote says. Every number, date, and name in `text` must appear in the quote.",
  "5. `sourceId` must be one of the listed source IDs, and the quote must come from that source.",
  "6. classification: verified = the source states it as fact; attributed = someone says it (add `attribution`); estimated = the source gives an estimate (add `caveat`); analysis = your inference (add `reasoning` and `sourceIds`, no quote, no new numbers).",
  "7. Prefer primary sources. If the text does not support a claim, leave it out. Fewer correct claims beat many doubtful ones.", "",
  "Reply with ONE JSON array inside a single code block, then a short list of what these sources did NOT cover.", "",
  "```json",
  "[{\"sourceId\":\"SRC-001\",\"quote\":\"<verbatim passage from the source text>\",\"text\":\"<one statement that says no more than the quote>\",\"classification\":\"verified\"}]",
  "```", "");
const qs = project.research?.questions || [];
if (qs.length) out.push("## Research questions", "", ...qs.map(q => "- " + q), "");
out.push("## Source texts", "");
let total = 0; const omitted = [];
for (const u of usable) {
  const body = u.text.slice(0, MAX_PER);
  if (total + body.length > MAX_TOTAL) { omitted.push(u.s.id); continue; }
  total += body.length;
  out.push("### " + u.s.id + " | " + (u.s.publisher || "?") + " | " + (u.s.title || "?") + " | type: " + (u.s.type || "?") + " | " + (u.s.canonicalUrl || u.s.url || ""), "", body, "");
}
if (omitted.length) out.push("(Omitted because the packet is full: " + omitted.join(", ") + ")", "");
await mkdir(path.join(dir, "research"), { recursive: true });
await writeFile(path.join(dir, "research", "CLAIMS-PACKET.md"), out.join("\n"));
console.log("Packet: " + (usable.length - omitted.length) + " sources, " + total + " characters.");
for (const x of excluded) console.log("EXCLUDED " + x.s.id + ": " + x.reason);
if (omitted.length) console.log("OMITTED (size): " + omitted.join(", "));
if (!usable.length) { console.error("ERROR no source has usable text."); process.exit(1); }
