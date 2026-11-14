import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const projectId = process.env.PROJECT_ID;
if (!projectId || !/^[a-z0-9-]+$/.test(projectId)) {
  throw new Error("Set PROJECT_ID to a valid project folder name.");
}

const dir = path.join("production", "projects", projectId);
const projectPath = path.join(dir, "project.json");
const project = JSON.parse(await readFile(projectPath, "utf8"));
const outDir = path.join(dir, "research", "source-snapshots");
await mkdir(outDir, { recursive: true });

// Bound downloads while allowing ordinary SEC filings and annual-report PDFs.
const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;
const MAX_HTML_BYTES = 12 * 1024 * 1024;
const MAX_TEXT_CHARS = 50000;
const MAX_PDF_PAGES = 120;
const TIMEOUT_MS = 30000;

const strip = value => String(value || "")
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
  .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
  .replace(/<!--[\s\S]*?-->/g, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/\s+/g, " ")
  .trim();

const meta = (html, wanted) => {
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const raw = tag[0];
    const key = (raw.match(/(?:name|property)=["']([^"']+)["']/i) || [])[1];
    const value = (raw.match(/content=["']([^"']*)["']/i) || [])[1];
    if (key?.toLowerCase() === wanted.toLowerCase()) return strip(value || "");
  }
  return "";
};

const titleOf = html => strip(
  html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ""
);

const safeUrl = value => {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (
      host === "localhost" || host.endsWith(".localhost") ||
      host === "127.0.0.1" || host === "0.0.0.0" || host === "::1" ||
      /^10\./.test(host) || /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) return null;
    return url;
  } catch {
    return null;
  }
};

// Read a response incrementally so a missing/incorrect Content-Length cannot bypass limits.
const readLimited = async (response, maxBytes) => {
  if (!response.body) throw new Error("Response has no readable body.");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("Response exceeds configured safety limit.");
        throw new Error("Response exceeds safety limit (" + maxBytes + " bytes).");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
};

const extractPdfText = async bytes => {
  const loadingTask = pdfjsLib.getDocument({
    data: bytes,
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true
  });
  let document;
  try {
    document = await loadingTask.promise;
    const pageLimit = Math.min(document.numPages, MAX_PDF_PAGES);
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .map(item => typeof item.str === "string" ? item.str : "")
        .filter(Boolean)
        .join(" ");
      pages.push("[Page " + pageNumber + "] " + pageText);
      page.cleanup();
      if (pages.join("\n").length >= MAX_TEXT_CHARS) break;
    }
    return {
      text: pages.join("\n").slice(0, MAX_TEXT_CHARS).trim(),
      pageCount: document.numPages,
      pagesExtracted: pageLimit,
      truncated: document.numPages > pageLimit
    };
  } finally {
    if (document) await document.destroy();
    else await loadingTask.destroy();
  }
};

const candidates = (project.research?.sources || [])
  .filter(source => source.url && !source.snapshotPath);
const results = [];
const errors = [];

for (const source of candidates) {
  const url = safeUrl(source.url);
  if (!url) {
    errors.push({ sourceId: source.id, error: "Rejected unsafe or invalid URL." });
    continue;
  }

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "User-Agent": "TheHiddenEngineResearchBot/1.1 (public-source-ingestion)",
        "Accept": "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.1"
      }
    });

    if (!response.ok) throw new Error("HTTP " + response.status);
    if (!safeUrl(response.url)) throw new Error("Rejected unsafe redirect destination.");

    const contentType = (response.headers.get("content-type") || "")
      .split(";")[0].trim().toLowerCase();
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_RESPONSE_BYTES) {
      throw new Error("Response exceeds safety limit (" + MAX_RESPONSE_BYTES + " bytes).");
    }

    const record = {
      sourceId: source.id,
      requestedUrl: source.url,
      canonicalUrl: response.url,
      status: response.status,
      contentType,
      fetchedAt: new Date().toISOString(),
      extractionStatus: "metadata_only",
      title: source.title || "",
      publisher: source.publisher || "",
      publishedAt: source.publishedAt || null
    };

    if (contentType === "application/pdf" || response.url.toLowerCase().split("?")[0].endsWith(".pdf")) {
      const bytes = await readLimited(response, MAX_RESPONSE_BYTES);
      const pdf = await extractPdfText(bytes);
      record.extractedText = pdf.text;
      record.textCharacters = pdf.text.length;
      record.pdfPageCount = pdf.pageCount;
      record.pdfPagesExtracted = pdf.pagesExtracted;
      record.contentSha256 = createHash("sha256").update(pdf.text).digest("hex");
      record.extractionStatus = pdf.text.length >= 300
        ? (pdf.truncated ? "pdf_text_truncated" : "pdf_text_extracted")
        : "thin_or_scanned_pdf";
      record.note = pdf.text.length < 300
        ? "Very little selectable text was found. The PDF may be scanned and require OCR."
        : "PDF text extracted locally. Tables, charts, footnotes, and reading order may need manual review.";
    } else if (contentType === "text/html" || contentType === "application/xhtml+xml" || contentType === "") {
      const bytes = await readLimited(response, Math.min(MAX_HTML_BYTES, MAX_RESPONSE_BYTES));
      const html = new TextDecoder("utf-8").decode(bytes);
      const title = titleOf(html) || meta(html, "og:title") || source.title || "";
      const description = meta(html, "description") || meta(html, "og:description");
      const author = meta(html, "author") || meta(html, "article:author");
      const published = meta(html, "article:published_time") || meta(html, "date");
      const main = html.match(/<(?:article|main)\b[^>]*>([\s\S]*?)<\/(?:article|main)>/i)?.[1] || html;
      const extractedText = strip(main).slice(0, MAX_TEXT_CHARS);

      record.title = title;
      record.description = description;
      record.author = author;
      record.publisherPublishedAt = published;
      record.extractedText = extractedText;
      record.textCharacters = extractedText.length;
      record.contentSha256 = createHash("sha256").update(extractedText).digest("hex");
      record.extractionStatus = extractedText.length >= 300
        ? "html_text_extracted"
        : "thin_or_blocked_content";
      record.note = "Automated extraction is a reading aid only. Check context, tables, footnotes, and original documents manually.";
    } else {
      const bytes = await readLimited(response, MAX_RESPONSE_BYTES);
      record.extractionStatus = "unsupported_content_type";
      record.responseBytes = bytes.byteLength;
      record.note = "Downloaded response metadata only; this content type has no configured text extractor.";
    }

    const file = String(source.id || "source").replace(/[^a-zA-Z0-9_-]/g, "_") + ".json";
    await writeFile(path.join(outDir, file), JSON.stringify(record, null, 2) + "\n");
    source.canonicalUrl = record.canonicalUrl;
    source.snapshotPath = path.join("research", "source-snapshots", file);
    source.ingestionStatus = record.extractionStatus;
    source.fetchedAt = record.fetchedAt;
    results.push({
      sourceId: source.id,
      status: record.extractionStatus,
      textCharacters: record.textCharacters || 0,
      canonicalUrl: record.canonicalUrl
    });
  } catch (error) {
    errors.push({ sourceId: source.id, error: error.message || String(error) });
  }
}

const at = new Date().toISOString();
project.research.sourceIngestion = {
  at,
  attempted: candidates.length,
  succeeded: results.length,
  failed: errors.length
};
project.research.researchLog = [
  ...(project.research.researchLog || []),
  {
    at,
    action: "public_source_ingestion",
    attempted: candidates.length,
    succeeded: results.length,
    failed: errors.length
  }
];
project.research.status = errors.length ? "ingestion_partial" : "ingestion_complete";
project.updatedAt = at;

await writeFile(projectPath, JSON.stringify(project, null, 2) + "\n");
const summary = {
  projectId,
  attempted: candidates.length,
  succeeded: results.length,
  failed: errors.length,
  results,
  errors,
  limits: {
    maxResponseBytes: MAX_RESPONSE_BYTES,
    maxHtmlBytes: MAX_HTML_BYTES,
    maxTextCharacters: MAX_TEXT_CHARS,
    maxPdfPages: MAX_PDF_PAGES
  },
  limitations: [
    "No login, paywall bypass, or script execution.",
    "Scanned/image-only PDFs require OCR and are reported as thin_or_scanned_pdf.",
    "PDF and HTML extraction may omit or reorder tables, footnotes, charts, and complex layouts.",
    "Extraction is not fact-checking; source context and every claim still require review."
  ]
};
await writeFile(path.join(dir, "research", "ingestion-report.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
