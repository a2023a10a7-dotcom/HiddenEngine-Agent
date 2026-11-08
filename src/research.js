import Parser from "rss-parser";
import {
  mkdir,
  writeFile,
  readFile
} from "node:fs/promises";
import path from "node:path";

const parser = new Parser({
  timeout: 20000,
  headers: {
    "User-Agent": "TheHiddenEngineResearchBot/1.0"
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
  minimumCoverageSources: 2
};

const SOURCES = [
  {
    name: "TechCrunch",
    url: "https://techcrunch.com/feed/"
  },
  {
    name: "Ars Technica",
    url: "https://feeds.arstechnica.com/arstechnica/index"
  },
  {
    name: "The Verge",
    url: "https://www.theverge.com/rss/index.xml"
  },
  {
    name: "BBC Technology",
    url: "https://feeds.bbci.co.uk/news/technology/rss.xml"
  },
  {
    name: "MIT Technology Review",
    url: "https://www.technologyreview.com/feed/"
  }
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
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTitle(title = "") {
  return cleanText(title)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\b(the|a|an|and|or|to|of|in|on|for|with)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getDomain(url = "") {
  try {
    return new URL(url).hostname
      .replace(/^www\./, "");
  } catch {
    return "";
  }
}

function validDate(value) {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  if (date.getTime() > Date.now() + 86400000) {
    return null;
  }

  return date;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

// -------------------------------------
// ARTICLE CLASSIFICATION
// -------------------------------------

function classify(text) {
  const scores = {};

  for (const [category, words] of Object.entries(CATEGORIES)) {
    scores[category] = words.reduce(
      (total, word) =>
        total + (text.includes(word.toLowerCase()) ? 1 : 0),
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
  const wordsA = new Set(normalizeTitle(a).split(" "));
  const wordsB = new Set(normalizeTitle(b).split(" "));

  if (!wordsA.size || !wordsB.size) return 0;

  const intersection = [...wordsA]
    .filter((word) => wordsB.has(word));

  const union = new Set([...wordsA, ...wordsB]);

  return intersection.length / union.size;
}

function removeDuplicates(articles) {
  const result = [];

  for (const article of articles) {
    const duplicate = result.find((existing) => {
      return (
        existing.link === article.link ||
        similarity(existing.title, article.title) >= 0.78
      );
    });

    if (!duplicate) {
      result.push(article);
    }
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
        "User-Agent": "Mozilla/5.0 TheHiddenEngine/1.0"
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const xml = await response.text();
    const feed = await parser.parseString(xml);

    const reports = (feed.items || []).map((item) => {
      const publisher =
        cleanText(item.creator || item.source?.title || "");

      const link = item.link || "";

      return {
        title: cleanText(item.title || ""),
        publisher: publisher || getDomain(link),
        link,
        date: item.isoDate || item.pubDate || ""
      };
    });

    const publishers = unique(
      reports.map((item) => item.publisher.toLowerCase())
    );

    return {
      status: "searched",
      reports: reports.slice(0, 12),
      publisherCount: publishers.length,
      publishers: publishers.slice(0, 12)
    };

  } catch (error) {
    return {
      status: "unavailable",
      error: error.message,
      reports: [],
      publisherCount: 0,
      publishers: []
    };
  }
}

// -------------------------------------
// EDITORIAL EVALUATION
// -------------------------------------

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
    "ai", "chip", "engine", "robot",
    "computer", "technology", "drone",
    "radar", "software", "science",
    "engineering", "system", "processor"
  ];

  const storyWords = [
    "company", "history", "secret",
    "failure", "founder", "battle",
    "competition", "rival", "crisis",
    "strategy", "rise", "collapse"
  ];

  const countMatches = (words) =>
    words.filter((word) => text.includes(word)).length;

  const interest = Math.min(
    20,
    5 + countMatches(interestWords) * 2
  );

  const technical = Math.min(
    15,
    3 + countMatches(technicalWords) * 2
  );

  const storytelling = Math.min(
    15,
    3 + countMatches(storyWords) * 2
  );

  const date = validDate(article.date);

  let freshness = 4;

  if (date) {
    const ageDays =
      Math.max(0, (Date.now() - date.getTime()) / 86400000);

    freshness = Math.max(0, 15 - ageDays * 1.5);
  }

  const relevance = Math.min(
    25,
    8 + (matchedCategories.length * 4)
  );

  // This is a neutral starting value.
  // It is not a factual credibility rating.
  const sourceCoverage = 5;

  return {
    ...article,
    category,
    matchedCategories,
    dateValid: Boolean(date),
    score: 0,
    scoreBreakdown: {
      relevance,
      interest,
      technical,
      storytelling,
      freshness: Math.round(freshness),
      sourceCoverage
    },
    angle: CATEGORY_ANGLES[category],
    coverage: null
  };
}

function updateScore(article) {
  const breakdown = article.scoreBreakdown;

  const coverageBonus = Math.min(
    10,
    Math.max(0, article.coverage.publisherCount - 1) * 2
  );

  breakdown.sourceCoverage = 5 + coverageBonus;

  article.score = Math.min(
    100,
    Math.round(
      breakdown.relevance +
      breakdown.interest +
      breakdown.technical +
      breakdown.storytelling +
      breakdown.freshness +
      breakdown.sourceCoverage
    )
  );

  return article;
}

// -------------------------------------
// EDITORIAL RECOMMENDATIONS
// -------------------------------------

function makeRecommendation(article) {
  const coverageCount =
    article.coverage?.publisherCount || 0;

  const warnings = [];

  if (coverageCount < CONFIG.minimumCoverageSources) {
    warnings.push(
      "Limited independent coverage found. Verify before publication."
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
        : article.score >= 60
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
  let report = `# THE HIDDEN ENGINE
## Editorial Intelligence Report

Date: ${date}
Articles analyzed: ${articles.length}

> Scores are automated editorial estimates, not facts or predictions of video performance.
> Coverage counts indicate search results from Google News, not proof of truth.

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

  articles
    .slice(0, CONFIG.topOpportunities)
    .forEach((article, index) => {
      const recommendation = makeRecommendation(article);
      const breakdown = article.scoreBreakdown;

      report += `### ${index + 1}. ${article.title}

- **Score:** ${article.score}/100
- **Priority:** ${recommendation.priority}
- **Category:** ${article.category}
- **Original source:** ${article.source}
- **Publication date:** ${article.date || "Unknown"}
- **Coverage publishers found:** ${article.coverage?.publisherCount ?? "Not searched"}
- **Suggested format:** ${recommendation.format}
- **Target audience:** ${recommendation.audience}

**Score breakdown**
- Relevance: ${breakdown.relevance}/25
- Interest: ${breakdown.interest}/20
- Technical depth: ${breakdown.technical}/15
- Storytelling potential: ${breakdown.storytelling}/15
- Freshness: ${breakdown.freshness}/15
- Coverage indicator: ${breakdown.sourceCoverage}/15

**Why it matters:** ${article.summary}

**Suggested video angle:** ${article.angle}

**Coverage search**
`;

      if (article.coverage?.reports?.length) {
        article.coverage.reports.slice(0, 6).forEach((item) => {
          report += `- ${item.publisher}: ${item.title} — ${item.link}\n`;
        });
      } else {
        report += "- No coverage results available.\n";
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
- Coverage publishers: ${article.coverage?.publisherCount ?? "Not searched"}
- Link: ${article.link}

`;
  });

  report += `
## NEXT RESEARCH STEPS

1. Read the original article.
2. Open the coverage links and compare the reporting.
3. Find primary sources, official statements, documents, or data.
4. Separate confirmed facts from claims and opinions.
5. Check dates, numbers, names, and quotations.
6. Decide whether the topic deserves a video.
7. Prepare the research dossier before writing the script.

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

  // Search coverage for the most promising stories.
  const coverageTargets = evaluated.slice(
    0,
    CONFIG.articlesToCheck
  );

  for (const article of coverageTargets) {
    console.log(`Checking coverage: ${article.title}`);

    article.coverage = await findCoverage(article);
    updateScore(article);
  }

  // Reorder after coverage research.
  evaluated.sort((a, b) => b.score - a.score);

  for (const article of evaluated) {
    if (!article.coverage) {
      article.coverage = {
        status: "not_checked",
        publisherCount: 0,
        publishers: [],
        reports: []
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
  await mkdir(
    path.join(CONFIG.outputDirectory, "archive"),
    { recursive: true }
  );

  await writeFile(
    path.join(
      CONFIG.outputDirectory,
      "archive",
      `${date}.json`
    ),
    JSON.stringify(data, null, 2),
    "utf8"
  );

  await writeFile(
    path.join(
      CONFIG.outputDirectory,
      "archive",
      `${date}.md`
    ),
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
