import Parser from "rss-parser";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const parser = new Parser({
  timeout: 20000,
  headers: {
    "User-Agent": "TheHiddenEngineResearchBot/2.0"
  }
});

// -------------------------------------
// CONFIGURATION
// -------------------------------------

const CONFIG = {
  maxArticles: 50,
  topOpportunities: 10,
  articlesToCheck: 8,
  requestTimeout: 15000,
  outputDirectory: "reports",
  language: "en-US",
  googleNewsRegion: "US",

  // Coverage discovery is an indicator, not fact verification.
  minimumCoverageSources: 2,

  // Diversity limits for the top opportunities.
  maxTopPerSource: 2,
  maxTopPerCategory: 4,

  // Minimum title similarity for accepting a coverage result.
  minimumCoverageSimilarity: 0.38
};

const SOURCES = [
  { name: "TechCrunch", url: "https://techcrunch.com/feed/" },
  { name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index" },
  { name: "The Verge", url: "https://www.theverge.com/rss/index.xml" },
  { name: "BBC Technology", url: "https://feeds.bbci.co.uk/news/technology/rss.xml" },
  { name: "MIT Technology Review", url: "https://www.technologyreview.com/feed/" }
];

const CATEGORIES = {
  "AI & Technology": [
    "artificial intelligence", "machine learning",
    "generative ai", "openai", "anthropic", "chatgpt",
    "robot", "semiconductor", "chip", "processor",
    "smartphone", "computer", "software",
    "cybersecurity", "quantum", "technology",
    "data center", "cloud computing"
  ],

  "Business Stories": [
    "company", "startup", "ceo", "business",
    "founder", "acquisition", "bankruptcy",
    "revenue", "investor", "market", "ipo",
    "apple", "google", "microsoft", "nvidia",
    "samsung", "tesla", "amazon"
  ],

  "Politics & Geopolitics": [
    "government", "china", "united states",
    "sanctions", "trade war", "geopolitics",
    "regulation", "election", "export controls",
    "national security", "tariffs", "policy"
  ],

  "Military Technology": [
    "military", "missile", "drone", "navy",
    "warship", "fighter jet", "radar",
    "defense", "defence", "weapon",
    "pentagon", "aircraft carrier", "torpedo",
    "submarine", "military technology",
    "electronic warfare", "air defense"
  ]
};

const CATEGORY_ANGLES = {
  "AI & Technology":
    "Explain how the technology works, its capabilities, limitations, and future impact.",

  "Business Stories":
    "Tell the company's story: its rise, strategy, rivals, decisions, and challenges.",

  "Politics & Geopolitics":
    "Explain the strategic interests, competing sides, and technological consequences.",

  "Military Technology":
    "Explore the engineering, history, capabilities, limitations, and strategic role.",

  "General Technology":
    "Explain the idea, why it matters, and how it could affect the future."
};

// -------------------------------------
// UTILITIES
// -------------------------------------

function cleanText(value = "") {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);/g, (_, code) =>
      String.fromCodePoint(Number(code))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
      String.fromCodePoint(parseInt(code, 16))
    )
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTitle(title = "") {
  return cleanText(title)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\b(the|a|an|and|or|to|of|in|on|for|with|from|by|as|at)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleTokens(title = "") {
  return normalizeTitle(title)
    .split(" ")
    .filter((word) => word.length > 2);
}

function getDomain(url = "") {
  try {
    return new URL(url).hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return "";
  }
}

function validDate(value) {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  if (date.getTime() > Date.now() + 86400000) {
    return null;
  }

  return date;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Match complete words or phrases, not accidental substrings.
// Example: "AI" should not match inside "chair".
function containsTerm(text, term) {
  const escaped = escapeRegExp(term.toLowerCase().trim())
    .replace(/\s+/g, "\\s+");

  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, "i")
    .test(text);
}

// -------------------------------------
// CLASSIFICATION
// -------------------------------------

function classify(text) {
  const normalized = text.toLowerCase();
  const scores = {};

  for (const [category, words] of Object.entries(CATEGORIES)) {
    scores[category] = words.reduce(
      (total, word) =>
        total + (containsTerm(normalized, word) ? 1 : 0),
      0
    );
  }

  const ranked = Object.entries(scores)
    .sort((a, b) => b[1] - a[1]);

  return {
    category:
      ranked[0]?.[1] > 0
        ? ranked[0][0]
        : "General Technology",

    matchedCategories: ranked
      .filter((item) => item[1] > 0)
      .map((item) => item[0])
  };
}

// -------------------------------------
// DUPLICATE DETECTION
// -------------------------------------

function similarity(a, b) {
  const wordsA = new Set(titleTokens(a));
  const wordsB = new Set(titleTokens(b));

  if (!wordsA.size || !wordsB.size) return 0;

  const intersection = [...wordsA]
    .filter((word) => wordsB.has(word));

  const union = new Set([...wordsA, ...wordsB]);

  return intersection.length / union.size;
}

function removeDuplicates(articles) {
  const result = [];

  for (const article of articles) {
    const duplicate = result.find((existing) =>
      existing.link === article.link ||
      similarity(existing.title, article.title) >= 0.78
    );

    if (!duplicate) result.push(article);
  }

  return result;
}

// -------------------------------------
// NEWS COLLECTION
// -------------------------------------

async function collectNews() {
  const articles = [];
  const sourceStatus = [];

  for (const source of SOURCES) {
    try {
      console.log(`Reading ${source.name}...`);

      const feed = await parser.parseURL(source.url);
      let count = 0;

      for (const item of feed.items || []) {
        const link = item.link || item.guid || "";

        if (!link.startsWith("http")) continue;

        articles.push({
          source: source.name,
          title: cleanText(item.title || "Untitled"),
          link,
          date: item.isoDate || item.pubDate || "",
          summary: cleanText(
            item.contentSnippet ||
            item.summary ||
            item.content ||
            "No summary available."
          ).slice(0, 1200)
        });

        count++;
      }

      sourceStatus.push({
        name: source.name,
        status: "OK",
        articles: count
      });

    } catch (error) {
      console.error(`${source.name}: ${error.message}`);

      sourceStatus.push({
        name: source.name,
        status: "FAILED",
        error: error.message
      });
    }
  }

  return {
    articles: removeDuplicates(articles),
    sourceStatus
  };
}

// -------------------------------------
// GOOGLE NEWS RSS SOURCE EXTRACTION
// -------------------------------------

function extractGoogleSourceTags(xml) {
  const blocks = [
    ...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)
  ];

  return blocks.map((match) => {
    const block = match[1];

    const sourceMatch = block.match(
      /<source\b([^>]*)>([\s\S]*?)<\/source>/i
    );

    if (!sourceMatch) {
      return {
        name: "",
        url: ""
      };
    }

    const attributes = sourceMatch[1];
    const name = cleanText(sourceMatch[2]);

    const urlMatch = attributes.match(
      /\burl\s*=\s*["']([^"']+)["']/i
    );

    return {
      name,
      url: urlMatch?.[1] || ""
    };
  });
}

function cleanPublisherName(name = "") {
  let publisher = cleanText(name);

  publisher = publisher
    .replace(/\s*[-|]\s*Google News\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  return publisher;
}

function publisherKey(report) {
  const domain = getDomain(report.publisherUrl);

  if (domain) return domain;

  return cleanPublisherName(report.publisher)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractPublisherFromTitle(title = "") {
  const parts = cleanText(title).split(/\s[-–|]\s/);

  if (parts.length < 2) return "";

  return parts[parts.length - 1].trim();
}

function removePublisherSuffix(title = "", publisher = "") {
  const cleanTitle = cleanText(title);

  if (!publisher) return cleanTitle;

  const suffix = new RegExp(
    `\\s[-–|]\\s${escapeRegExp(publisher)}\\s*$`,
    "i"
  );

  return cleanTitle.replace(suffix, "").trim();
}

// -------------------------------------
// COVERAGE RELEVANCE
// -------------------------------------

function coverageSimilarity(originalTitle, reportTitle) {
  const original = new Set(titleTokens(originalTitle));
  const candidate = new Set(titleTokens(reportTitle));

  if (!original.size || !candidate.size) return 0;

  const overlap = [...original]
    .filter((word) => candidate.has(word));

  const overlapAgainstOriginal = overlap.length / original.size;
  const overlapAgainstCandidate = overlap.length / candidate.size;

  // A result must share a meaningful portion of the original title.
  // This is a discovery filter, not proof that both articles describe
  // exactly the same event.
  return Math.max(
    overlapAgainstOriginal * 0.7 + overlapAgainstCandidate * 0.3,
    overlapAgainstOriginal * 0.85
  );
}

// -------------------------------------
// GOOGLE NEWS COVERAGE SEARCH
// -------------------------------------

async function findCoverage(article) {
  const query = encodeURIComponent(
    `"${article.title.slice(0, 120)}"`
  );

  const url =
    `https://news.google.com/rss/search?q=${query}` +
    `&hl=${CONFIG.language}` +
    `&gl=${CONFIG.googleNewsRegion}` +
    `&ceid=${CONFIG.googleNewsRegion}:en`;

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(CONFIG.requestTimeout),
      headers: {
        "User-Agent": "Mozilla/5.0 TheHiddenEngine/2.0"
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const xml = await response.text();
    const feed = await parser.parseString(xml);
    const sourceTags = extractGoogleSourceTags(xml);

    const reports = [];

    for (let index = 0; index < (feed.items || []).length; index++) {
      const item = feed.items[index];
      const sourceTag = sourceTags[index] || {};

      const rawTitle = cleanText(item.title || "");
      const sourceFromTitle = extractPublisherFromTitle(rawTitle);

      const publisher = cleanPublisherName(
        sourceTag.name ||
        item.creator ||
        item.source?.title ||
        sourceFromTitle
      );

      const publisherUrl = sourceTag.url || "";
      const title = removePublisherSuffix(rawTitle, publisher);
      const link = item.link || "";

      if (!title || !link) continue;

      const matchScore = coverageSimilarity(
        article.title,
        title
      );

      if (matchScore < CONFIG.minimumCoverageSimilarity) {
        continue;
      }

      reports.push({
        title,
        publisher: publisher || "Publisher not identified",
        publisherUrl,
        publisherDomain:
          getDomain(publisherUrl) || getDomain(link),
        link,
        date: item.isoDate || item.pubDate || "",
        relevance: Number(matchScore.toFixed(3))
      });
    }

    // Remove duplicate links.
    const uniqueReports = [];
    const seenLinks = new Set();

    for (const report of reports) {
      if (seenLinks.has(report.link)) continue;

      seenLinks.add(report.link);
      uniqueReports.push(report);
    }

    // Count distinct publisher identifiers.
    // This does NOT establish independent ownership or reporting.
    const publisherIds = unique(
      uniqueReports
        .map(publisherKey)
        .filter(Boolean)
    );

    return {
      status: "searched",
      reports: uniqueReports.slice(0, 12),
      publisherCount: publisherIds.length,
      publishers: uniqueReports
        .map((item) => item.publisher)
        .filter((name, index, list) =>
          list.findIndex(
            (other) => other.toLowerCase() === name.toLowerCase()
          ) === index
        )
        .slice(0, 12),
      note: "Distinct publisher identifiers found; independence and factual accuracy are not verified."
    };

  } catch (error) {
    return {
      status: "unavailable",
      error: error.message,
      reports: [],
      publisherCount: 0,
      publishers: [],
      note: "Coverage search unavailable."
    };
  }
}

// -------------------------------------
// EDITORIAL EVALUATION
// -------------------------------------

function countMatches(text, words) {
  return words.filter((word) =>
    containsTerm(text, word)
  ).length;
}

function evaluate(article) {
  const text =
    `${article.title} ${article.summary}`.toLowerCase();

  const { category, matchedCategories } = classify(text);

  const interestWords = [
    "first", "new", "secret", "breakthrough",
    "failure", "crisis", "launch", "future",
    "discovery", "revolution", "billion",
    "million", "world", "record", "largest",
    "unexpected", "controversy"
  ];

  const technicalWords = [
    "artificial intelligence", "ai", "chip",
    "engine", "robot", "computer", "technology",
    "drone", "radar", "software", "science",
    "engineering", "system", "processor",
    "semiconductor", "algorithm", "satellite"
  ];

  const storyWords = [
    "company", "history", "secret",
    "failure", "founder", "battle",
    "competition", "rival", "crisis",
    "strategy", "rise", "collapse",
    "decision", "conflict", "investigation"
  ];

  const interest = Math.min(
    20,
    4 + countMatches(text, interestWords) * 2
  );

  const technical = Math.min(
    15,
    2 + countMatches(text, technicalWords) * 2
  );

  const storytelling = Math.min(
    15,
    2 + countMatches(text, storyWords) * 2
  );

  const date = validDate(article.date);

  let freshness = 3;

  if (date) {
    const ageDays = Math.max(
      0,
      (Date.now() - date.getTime()) / 86400000
    );

    freshness = Math.max(
      0,
      Math.round(15 - ageDays * 1.5)
    );
  }

  const relevance = Math.min(
    25,
    5 + matchedCategories.length * 5
  );

  // Specificity measures whether the available material contains
  // concrete names, numbers, dates, or technical details.
  const hasNumbers = /\b\d+(?:[.,]\d+)?%?\b/.test(text);
  const hasNamedEntities = /\b[A-Z][a-z]{2,}\b/.test(
    `${article.title} ${article.summary}`
  );
  const hasLongSummary = article.summary.length >= 250;

  const specificity = Math.min(
    10,
    2 +
    (hasNumbers ? 3 : 0) +
    (hasNamedEntities ? 2 : 0) +
    (hasLongSummary ? 3 : 0)
  );

  const scoreBreakdown = {
    relevance,
    interest,
    technical,
    storytelling,
    freshness,
    specificity
  };

  const score = Object.values(scoreBreakdown)
    .reduce((sum, value) => sum + value, 0);

  return {
    ...article,
    category,
    matchedCategories,
    dateValid: Boolean(date),
    score,
    scoreBreakdown,
    angle: CATEGORY_ANGLES[category],
    coverage: null
  };
}

// -------------------------------------
// SCORE UPDATE
// -------------------------------------

function updateScore(article) {
  // Coverage is deliberately excluded from the editorial score.
  // More search results do not automatically make a story better.
  article.score = Object.values(article.scoreBreakdown)
    .reduce((sum, value) => sum + value, 0);

  return article;
}

// -------------------------------------
// EDITORIAL DIVERSITY
// -------------------------------------

function selectDiverseOpportunities(articles) {
  const selected = [];
  const remaining = [...articles];

  const sourceCounts = new Map();
  const categoryCounts = new Map();

  function canSelect(article) {
    const sourceCount =
      sourceCounts.get(article.source) || 0;

    const categoryCount =
      categoryCounts.get(article.category) || 0;

    return (
      sourceCount < CONFIG.maxTopPerSource &&
      categoryCount < CONFIG.maxTopPerCategory
    );
  }

  while (
    selected.length < CONFIG.topOpportunities &&
    remaining.length
  ) {
    const index = remaining.findIndex(canSelect);

    if (index === -1) break;

    const [article] = remaining.splice(index, 1);
    selected.push(article);

    sourceCounts.set(
      article.source,
      (sourceCounts.get(article.source) || 0) + 1
    );

    categoryCounts.set(
      article.category,
      (categoryCounts.get(article.category) || 0) + 1
    );
  }

  // If strict diversity limits prevent filling the list,
  // fill remaining positions with the highest-scoring stories.
  while (
    selected.length < CONFIG.topOpportunities &&
    remaining.length
  ) {
    selected.push(remaining.shift());
  }

  return selected;
}

// -------------------------------------
// EDITORIAL RECOMMENDATIONS
// -------------------------------------

function makeRecommendation(article) {
  const coverageCount =
    article.coverage?.publisherCount || 0;

  const warnings = [];

  if (
    article.coverage?.status === "searched" &&
    coverageCount < CONFIG.minimumCoverageSources
  ) {
    warnings.push(
      "Few matching coverage results found. Search for additional reporting and primary sources."
    );
  }

  if (article.coverage?.status === "unavailable") {
    warnings.push(
      "Coverage search failed. No conclusion can be drawn about how widely this story is reported."
    );
  }

  if (!article.dateValid) {
    warnings.push(
      "Publication date is missing or invalid."
    );
  }

  if (article.summary.length < 100) {
    warnings.push(
      "The available summary is short. Read the original article."
    );
  }

  return {
    priority:
      article.score >= 75
        ? "High"
        : article.score >= 55
          ? "Medium"
          : "Low",

    audience:
      article.category === "Military Technology"
        ? "Technology and defense enthusiasts"
        : article.category === "Business Stories"
          ? "Business and technology audience"
          : "General technology audience",

    format:
      article.category === "Business Stories"
        ? "Company story / Documentary"
        : article.category === "Military Technology"
          ? "Engineering analysis / Documentary"
          : "Explainer / Analysis",

    warnings
  };
}

// -------------------------------------
// REPORT GENERATION
// -------------------------------------

function markdownEscape(value = "") {
  return String(value).replace(/\|/g, "\\|");
}

function buildMarkdown(articles, sourceStatus, date) {
  const topArticles = selectDiverseOpportunities(articles);

  let report = `# THE HIDDEN ENGINE
## Editorial Intelligence Report

Date: ${date}
Articles analyzed: ${articles.length}

> Scores are automated editorial estimates, not facts or predictions of video performance.
> Coverage counts are matching Google News search results, not proof of accuracy or independent reporting.
> Coverage discovery is not fact-checking.

## SOURCE STATUS

`;

  for (const source of sourceStatus) {
    report += `- **${source.name}:** ${source.status}`;

    if (source.articles !== undefined) {
      report += ` (${source.articles} articles)`;
    }

    if (source.error) {
      report += ` — ${source.error}`;
    }

    report += "\n";
  }

  report += "\n## TOP VIDEO OPPORTUNITIES\n\n";

  topArticles.forEach((article, index) => {
    const recommendation = makeRecommendation(article);
    const breakdown = article.scoreBreakdown;

    report += `### ${index + 1}. ${article.title}

- **Score:** ${article.score}/100
- **Priority:** ${recommendation.priority}
- **Category:** ${article.category}
- **Original source:** ${article.source}
- **Publication date:** ${article.date || "Unknown"}
- **Matching coverage publishers:** ${article.coverage?.publisherCount ?? "Not searched"}
- **Suggested format:** ${recommendation.format}
- **Target audience:** ${recommendation.audience}

**Score breakdown**
- Relevance: ${breakdown.relevance}/25
- Interest: ${breakdown.interest}/20
- Technical depth: ${breakdown.technical}/15
- Storytelling potential: ${breakdown.storytelling}/15
- Freshness: ${breakdown.freshness}/15
- Specificity: ${breakdown.specificity}/10

**Why it matters:** ${article.summary}

**Suggested video angle:** ${article.angle}

**Coverage search**
`;

    if (article.coverage?.reports?.length) {
      article.coverage.reports.slice(0, 6).forEach((item) => {
        report += `- ${item.publisher}: ${item.title} — ${item.link}\n`;
      });

      report += `\nDistinct publisher identifiers: ${article.coverage.publisherCount}\n`;
      report += `Note: ${article.coverage.note}\n`;
    } else {
      report += "- No matching coverage results available.\n";
    }

    if (recommendation.warnings.length) {
      report += "\n**Research warnings**\n";

      recommendation.warnings.forEach((warning) => {
        report += `- ${warning}\n`;
      });
    }

    report += `\n**Original article:** ${article.link}

---

`;
  });

  report += "\n## ALL ANALYZED STORIES\n\n";

  articles.forEach((article, index) => {
    report += `${index + 1}. **${markdownEscape(article.title)}**

- Score: ${article.score}/100
- Category: ${article.category}
- Source: ${article.source}
- Matching coverage publishers: ${article.coverage?.publisherCount ?? "Not searched"}
- Link: ${article.link}

`;
  });

  report += `
## NEXT RESEARCH STEPS

1. Read the original article.
2. Open the coverage links and compare the reporting.
3. Identify primary sources, official statements, documents, or data.
4. Separate confirmed facts from claims and opinions.
5. Check dates, numbers, names, and quotations.
6. Check whether different outlets rely on the same original report.
7. Decide whether the topic deserves a video.
8. Prepare the research dossier before writing the script.

`;

  return report;
}

// -------------------------------------
// CSV EXPORT
// -------------------------------------

function csvEscape(value = "") {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function buildCSV(articles) {
  const rows = [
    [
      "Title",
      "Category",
      "Score",
      "Source",
      "Date",
      "Coverage Publishers",
      "Coverage Status",
      "Link"
    ]
  ];

  for (const article of articles) {
    rows.push([
      article.title,
      article.category,
      article.score,
      article.source,
      article.date,
      article.coverage?.publisherCount ?? 0,
      article.coverage?.status ?? "not_checked",
      article.link
    ]);
  }

  return rows
    .map((row) => row.map(csvEscape).join(","))
    .join("\n");
}

// -------------------------------------
// MAIN
// -------------------------------------

async function main() {
  console.log("Starting The Hidden Engine research agent...");

  const { articles: collected, sourceStatus } =
    await collectNews();

  const evaluated = collected
    .map(evaluate)
    .sort((a, b) => b.score - a.score)
    .slice(0, CONFIG.maxArticles);

  console.log(`Collected ${evaluated.length} unique articles.`);

  const coverageTargets = evaluated.slice(
    0,
    CONFIG.articlesToCheck
  );

  for (const article of coverageTargets) {
    console.log(`Checking coverage: ${article.title}`);

    article.coverage = await findCoverage(article);
    updateScore(article);

    console.log(
      `Matching reports: ${article.coverage.reports.length}; ` +
      `publisher identifiers: ${article.coverage.publisherCount}`
    );
  }

  // Scores do not depend on coverage.
  evaluated.sort((a, b) => b.score - a.score);

  for (const article of evaluated) {
    if (!article.coverage) {
      article.coverage = {
        status: "not_checked",
        publisherCount: 0,
        publishers: [],
        reports: [],
        note: "Coverage was not searched for this article."
      };
    }

    article.recommendation =
      makeRecommendation(article);
  }

  await mkdir(CONFIG.outputDirectory, {
    recursive: true
  });

  const date = new Date().toISOString().slice(0, 10);
  const timestamp = new Date().toISOString();

  const report = buildMarkdown(
    evaluated,
    sourceStatus,
    date
  );

  const data = {
    project: "The Hidden Engine",
    generatedAt: timestamp,
    date,
    configuration: CONFIG,
    sourceStatus,
    totalArticles: evaluated.length,
    topOpportunities: selectDiverseOpportunities(evaluated)
      .map((article) => article.title),
    articles: evaluated
  };

  // Latest reports.
  await writeFile(
    path.join(CONFIG.outputDirectory, "weekly-research.md"),
    report,
    "utf8"
  );

  await writeFile(
    path.join(CONFIG.outputDirectory, "research.json"),
    JSON.stringify(data, null, 2),
    "utf8"
  );

  await writeFile(
    path.join(CONFIG.outputDirectory, "research.csv"),
    buildCSV(evaluated),
    "utf8"
  );

  // Dated archive.
  const archiveDirectory = path.join(
    CONFIG.outputDirectory,
    "archive"
  );

  await mkdir(archiveDirectory, {
    recursive: true
  });

  await writeFile(
    path.join(archiveDirectory, `${date}.json`),
    JSON.stringify(data, null, 2),
    "utf8"
  );

  await writeFile(
    path.join(archiveDirectory, `${date}.md`),
    report,
    "utf8"
  );

  console.log("--------------------------------");
  console.log("Research completed.");
  console.log(`Articles: ${evaluated.length}`);
  console.log(`Coverage checks: ${coverageTargets.length}`);
  console.log("Reports: Markdown, JSON, CSV");
  console.log("Archive: saved");
  console.log("--------------------------------");
}

main().catch((error) => {
  console.error("Research failed:", error);
  process.exit(1);
});
