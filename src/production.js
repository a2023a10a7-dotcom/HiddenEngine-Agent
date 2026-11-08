import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const REPORT_PATH = "reports/research.json";
const OUTPUT_ROOT = "production/projects";

function slugify(value = "") {
  return value.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "").slice(0, 70) || "untitled-story";
}
function safe(value) {
  return String(value ?? "Not provided").replace(/\r/g, "").trim();
}
function buildMarkdown(article, projectId, generatedAt) {
  const coverage = article.coverage?.reports ?? [];
  const warnings = article.recommendation?.warnings ?? [];
  const sourceLines = coverage.length
    ? coverage.map((item, i) => (i + 1) + ". **" + safe(item.publisher) +
      "** — [" + safe(item.title) + "](" + safe(item.link) + ")\n   - Match relevance: " +
      (item.relevance ?? "unknown") + "\n").join("\n")
    : "No matching coverage links were recorded in the research report.\n";
  return [
    "# The Hidden Engine — Production Dossier",
    "",
    "- Project ID: " + projectId,
    "- Generated: " + generatedAt,
    "- Status: **RESEARCH REQUIRED — NOT SCRIPT-READY**",
    "- Original publisher: " + safe(article.source),
    "- Original publication date: " + safe(article.date),
    "- Editorial score: " + (article.score ?? "unknown") + "/100",
    "",
    "## 1. Story selected",
    "",
    "**" + safe(article.title) + "**",
    "",
    "Original article: " + safe(article.link),
    "",
    "### Available summary",
    safe(article.summary),
    "",
    "### Initial editorial angle",
    safe(article.angle),
    "",
    "> This is a production scaffold, not a verified account. RSS summaries and matching-news results are leads only. Do not narrate allegations, numbers, quotations, or causal claims as facts until their original evidence has been checked.",
    "",
    "## 2. Coverage leads (not independent verification)",
    "",
    sourceLines,
    "Coverage status: " + safe(article.coverage?.status),
    "Publisher identifiers: " + (article.coverage?.publisherCount ?? "unknown"),
    "",
    "A matching headline does not prove independent reporting, accuracy, or corroboration. Check whether outlets rely on the same underlying source.",
    "",
    "## 3. Verification checklist",
    "",
    "- [ ] Read the complete original report.",
    "- [ ] Identify primary sources: papers, filings, official statements, datasets, technical documentation, or direct interviews.",
    "- [ ] Find genuinely independent reputable reports where available.",
    "- [ ] Verify dates and distinguish announcement, demonstration, deployment, and commercial availability.",
    "- [ ] Verify every number, name, quote, and technical specification against its source.",
    "- [ ] Record disputed, unknown, and anonymously sourced claims.",
    "- [ ] Separate established facts, attributed claims, analysis, and speculation.",
    "- [ ] Add source URLs and access dates to the final script.",
    "- [ ] Obtain editorial approval before voiceover or publication.",
    "",
    "### Automated warnings",
    warnings.length ? warnings.map((w) => "- " + safe(w)).join("\n") :
      "- No automated warnings were supplied. This is not evidence that the story is verified.",
    "",
    "## 4. Research questions",
    "",
    "1. What exactly happened, and what is the strongest primary evidence?",
    "2. Who are the key organizations and people, and what are their documented roles?",
    "3. How does the relevant technology or system work?",
    "4. What changed compared with the previous state of the art?",
    "5. What are the measurable capabilities and limitations?",
    "6. Who benefits, who bears the costs, and what incentives shape the story?",
    "7. What is the strategic or engineering significance?",
    "8. What remains uncertain or is being overstated?",
    "",
    "## 5. Documentary script blueprint",
    "",
    "**Format:** English-language technology documentary",
    "**Suggested duration:** 6–8 minutes, adjusted after research",
    "**Voice:** clear, analytical, restrained; no sensational claims.",
    "",
    "| Section | Approx. time | Purpose | Evidence needed |",
    "|---|---:|---|---|",
    "| Cold open | 0:00–0:30 | Present the central puzzle | One verified, compelling fact |",
    "| Context | 0:30–1:30 | Explain the background | Timeline and actors |",
    "| How it works | 1:30–3:00 | Explain the engineering | Primary technical sources |",
    "| Turning point | 3:00–4:30 | Explain what changed | Documents and attributable claims |",
    "| Strategic impact | 4:30–6:30 | Explain winners, risks, consequences | Independent evidence |",
    "| Conclusion | 6:30–7:30 | State what is known and unknown | Balanced synthesis |",
    "",
    "**Do not write final narration until verification is complete.**",
    "",
    "## 6. Scene and edit plan",
    "",
    "| Scene | Visual direction | On-screen text | Audio |",
    "|---|---|---|---|",
    "| 01 — Hook | Original motion graphic illustrating the verified question | One verified fact | Restrained opening sound |",
    "| 02 — Context | Dated timeline and identifiers | Dates and names with source | Narration |",
    "| 03 — Engineering | Original explanatory diagram; label unknowns | Verified technical terms | Narration and subtle effects |",
    "| 04 — Evidence | Source documents, charts, attributed quotations | Source and date visible | Narration |",
    "| 05 — Implications | Clearly labelled scenarios or comparisons | Separate fact from analysis | Narration |",
    "| 06 — Conclusion | Recap graphic with known/unknown split | Key takeaway | Clean outro |",
    "",
    "Use licensed, public-domain, or original visuals only. Do not imply illustrative footage depicts the actual event. Keep source attribution readable.",
    "",
    "## 7. Asset checklist",
    "",
    "- [ ] Original title card and thumbnail concept",
    "- [ ] Original diagrams for technical explanations",
    "- [ ] Licensed/public-domain footage with source records",
    "- [ ] Maps and charts based on verified data",
    "- [ ] Music and sound effects with documented usage rights",
    "- [ ] Captions checked against final narration",
    "",
    "## 8. Production gates",
    "",
    "1. Research verified and source log complete.",
    "2. Script reviewed and approved.",
    "3. Visual rights checked.",
    "4. Voiceover and edit reviewed.",
    "5. Owner approval required before publishing.",
    "",
    "---",
    "Generated by HiddenEngine Agent. No facts were independently verified by this generator."
  ].join("\n");
}

async function main() {
  const report = JSON.parse(await readFile(REPORT_PATH, "utf8"));
  const articles = Array.isArray(report.articles) ? report.articles : [];
  if (!articles.length) throw new Error("No articles found in reports/research.json");
  const requestedTitle = process.env.STORY_TITLE?.trim();
  const rawStoryIndex = (process.env.STORY_INDEX ?? "").trim();
  const requestedIndex = rawStoryIndex === "" ? 2 : Number(rawStoryIndex);
  const topTitles = Array.isArray(report.topOpportunities) ? report.topOpportunities : [];
  let article;
  if (requestedTitle) {
    article = articles.find((item) => item.title?.toLowerCase() === requestedTitle.toLowerCase());
    if (!article) throw new Error("STORY_TITLE was not found in the current research report.");
  } else {
    if (!Number.isInteger(requestedIndex) || requestedIndex < 1 || requestedIndex > 10)
      throw new Error("STORY_INDEX must be a number from 1 to 10.");
    const title = topTitles[requestedIndex - 1];
    if (!title) throw new Error("Top opportunity #" + requestedIndex + " is not available.");
    article = articles.find((item) => item.title === title);
    if (!article) throw new Error("Selected top opportunity has no matching article record.");
  }
  const generatedAt = new Date().toISOString();
  const projectId = generatedAt.slice(0, 10) + "-" + slugify(article.title);
  const outputDir = path.join(OUTPUT_ROOT, projectId);
  await mkdir(outputDir, { recursive: true });
  const project = {
    project: "The Hidden Engine",
    projectId,
    status: "research_required",
    generatedAt,
    researchReportGeneratedAt: report.generatedAt ?? null,
    selectedStory: {
      title: article.title, source: article.source, link: article.link,
      date: article.date, summary: article.summary, category: article.category,
      editorialScore: article.score, angle: article.angle,
      coverage: article.coverage ?? null,
      automatedWarnings: article.recommendation?.warnings ?? []
    },
    editorialRules: {
      independentVerificationRequired: true,
      primarySourcesRequired: true,
      noUnsupportedClaims: true,
      ownerApprovalBeforePublishing: true
    }
  };
  await writeFile(path.join(outputDir, "project.json"), JSON.stringify(project, null, 2) + "\n");
  await writeFile(path.join(outputDir, "production-dossier.md"), buildMarkdown(article, projectId, generatedAt));
  console.log("Production dossier created: " + outputDir);
  console.log("Selected story: " + article.title);
}
main().catch((error) => {
  console.error("Production preparation failed:", error);
  process.exit(1);
});
