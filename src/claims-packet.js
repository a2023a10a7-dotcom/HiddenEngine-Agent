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
    if (!/^(html|pdf)_text_(extracted|truncated)$/.test(r.extractionStatus || "") || !r.extractedText) return { reason: "no usable text (" + (r.extractionStatus || "unknown") + "); paste the relevant text into research/manual-text/" + s.id + ".txt" };
    return { text: r.extractedText, from: "page snapshot", truncated: /truncated$/.test(r.extractionStatus), extractionStatus: r.extractionStatus };
  } catch { return { reason: "snapshot file unreadable" }; }
}


const COMMON_TERMS = ["revenue","data center","datacenter","gaming","networking","gross margin","operating income","operating margin","net income","cash flow","free cash flow","customer","customers","supply","supplier","manufacturing","foundry","packaging","inventory","purchase commitments","capital expenditures","export","china","competition","market share","accelerated computing","artificial intelligence","generative ai","gpu","blackwell","hopper","h100","h200","b200","cuda","software","licensing","inference","training","network","ethernet","infiniband","gross profit","accounts receivable"];
const TECH_TERMS = ["cuda","programming model","compiler","kernel","developer","library","runtime","parallel","thread","memory","performance","compatibility","architecture","toolkit","deployment","accelerated computing","gpu"];
function scoreWindow(text, source) {
  const lower = text.toLowerCase();
  const terms = source.type === "technical_paper" || /cuda|developer/i.test(source.title || "") ? [...COMMON_TERMS, ...TECH_TERMS] : COMMON_TERMS;
  let score = 0;
  for (const term of new Set(terms)) {
    const count = lower.split(term.toLowerCase()).length - 1;
    if (count) score += Math.min(count, 5) * (term.length >= 10 ? 3 : 2);
  }
  const numbers = (text.match(/(?:US\$|\$|€|£)?\b\d[\d,]*(?:\.\d+)?\s?(?:%|percent|billion|million|trillion|thousand)?/gi) || []).length;
  const dates = (text.match(/\b(?:19|20)\d{2}\b/g) || []).length;
  const currency = (text.match(/(?:US\$|\$|€|£)\s?\d[\d,.]*/g) || []).length;
  score += Math.min(numbers, 18) * 1.5 + Math.min(dates, 5) * 1.5 + Math.min(currency, 8) * 3;
  if (/table of contents|forward-looking statements|incorporation by reference|skip to main content/i.test(text)) score -= 12;
  if (/revenue|gross margin|operating income|cash flow|data center|customer concentration|supply chain|inventory|capital expenditure/i.test(lower)) score += 8;
  return score;
}
function selectRelevantText(text, source, limit) {
  if (text.length <= limit) return { text, selected: text.length, excerpts: 1 };
  const ranked = [], windowSize = 1800, stride = 1350;
  for (let start = 0; start < text.length; start += stride) {
    const end = Math.min(text.length, start + windowSize);
    ranked.push({ start, end, score: scoreWindow(text.slice(start, end), source) });
    if (end === text.length) break;
  }
  ranked.sort((a, b) => b.score - a.score || a.start - b.start);
  const chosen = []; let used = 0;
  for (const w of ranked) {
    if (used >= limit) break;
    if (chosen.some(x => w.start < x.end && w.end > x.start)) continue;
    const end = Math.min(w.end, w.start + limit - used);
    if (end - w.start < 350) continue;
    chosen.push({ start: w.start, end, part: text.slice(w.start, end) }); used += end - w.start;
  }
  chosen.sort((a, b) => a.start - b.start);
  return { text: chosen.map((w, i) => "[Excerpt " + (i + 1) + " | original characters " + w.start + "-" + w.end + "]\n" + w.part).join("\n\n"), selected: used, excerpts: chosen.length };
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
  "3. `quote` must be copied VERBATIM and contiguously from one excerpt (40 to 400 characters). Do not join excerpts. No ellipses or edits.",
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
  const allowance = Math.min(MAX_PER, MAX_TOTAL - total);
  if (allowance < 350) { omitted.push(u.s.id); continue; }
  const picked = selectRelevantText(u.text, u.s, allowance);
  if (!picked.selected) { omitted.push(u.s.id); continue; }
  total += picked.selected;
  const flags = [u.extractionStatus || u.from, u.truncated ? "SAVED TEXT TRUNCATED" : ""].filter(Boolean).join("; ");
  out.push("### " + u.s.id + " | " + (u.s.publisher || "?") + " | " + (u.s.title || "?") + " | type: " + (u.s.type || "?") + " | " + (u.s.canonicalUrl || u.s.url || ""), "", "Extraction: " + flags + " | saved characters: " + u.text.length + " | selected characters: " + picked.selected + " | excerpts: " + picked.excerpts, "", picked.text, "");
}
if (omitted.length) out.push("(Omitted because the packet is full: " + omitted.join(", ") + ")", "");
const truncated = usable.filter(u => u.truncated).map(u => u.s.id);
if (truncated.length) out.push("## Coverage warning", "", "Saved extraction is truncated for: " + truncated.join(", ") + ". This packet can only select from saved text; rerun ingestion with a higher extraction limit to access later sections.", "");
await mkdir(path.join(dir, "research"), { recursive: true });
await writeFile(path.join(dir, "research", "CLAIMS-PACKET.md"), out.join("\n"));
console.log("Packet: " + (usable.length - omitted.length) + " sources, " + total + " characters.");
for (const x of excluded) console.log("EXCLUDED " + x.s.id + ": " + x.reason);
if (omitted.length) console.log("OMITTED (size): " + omitted.join(", "));
if (!usable.length) { console.error("ERROR no source has usable text."); process.exit(1); }
