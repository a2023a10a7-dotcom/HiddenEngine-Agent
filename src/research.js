
import Parser from "rss-parser";
import { mkdir, writeFile } from "node:fs/promises";

const parser = new Parser({ timeout: 15000 });

const SOURCES = [
  { name: "TechCrunch", url: "https://techcrunch.com/feed/" },
  { name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index" },
  { name: "The Verge", url: "https://www.theverge.com/rss/index.xml" }
];

const CATEGORIES = {
  "AI & Technology": [
    "AI", "artificial intelligence", "robot", "chip",
    "computer", "smartphone", "software", "technology",
    "cybersecurity", "semiconductor", "internet", "quantum"
  ],
  "Business Stories": [
    "company", "startup", "ceo", "business", "founder",
    "acquisition", "bankruptcy", "revenue", "investor",
    "market", "ipo", "apple", "google", "microsoft"
  ],
  "Politics & Geopolitics": [
    "government", "china", "united states", "sanctions",
    "trade war", "geopolitics", "regulation", "election",
    "export controls", "national security"
  ],
  "Military Technology": [
    "military", "missile", "drone", "navy", "warship",
    "fighter jet", "radar", "defense", "weapon",
    "pentagon", "aircraft carrier", "torpedo"
  ]
};

function classify(text) {
  let best = "General Technology";
  let highest = 0;

  for (const [category, words] of Object.entries(CATEGORIES)) {
    const score = words.reduce((total, word) => {
      return total + (text.includes(word.toLowerCase()) ? 1 : 0);
    }, 0);

    if (score > highest) {
      highest = score;
      best = category;
    }
  }

  return best;
}

function evaluate(article) {
  const text = `${article.title} ${article.summary}`.toLowerCase();

  const category = classify(text);

  const keywords = [
    "first", "new", "secret", "breakthrough",
    "failure", "crisis", "launch", "future",
    "discovery", "revolution", "billion", "world"
  ];

  const interest = Math.min(
    25,
    8 + keywords.filter(word => text.includes(word)).length * 3
  );

  const technical = Math.min(
    25,
    10 + (text.match(/ai|chip|engine|robot|computer|technology|drone|radar/g) || []).length * 2
  );

  const storytelling = Math.min(
    20,
    8 + (text.match(/company|history|secret|failure|founder|battle|competition/g) || []).length * 3
  );

  const freshness = article.date
    ? Math.max(0, 15 - Math.max(
        0,
        (Date.now() - new Date(article.date).getTime()) / 86400000
      ) * 2)
    : 5;

  const sourceScore = 15;

  const total = Math.round(
    technical + interest + storytelling + freshness + sourceScore
  );

  const angles = {
    "AI & Technology": "Explain the technology, how it works, and what changes.",
    "Business Stories": "Tell the company's story: its rise, decisions, rivals, and challenges.",
    "Politics & Geopolitics": "Explain the strategic interests and technological consequences.",
    "Military Technology": "Explore the engineering, history, and strategic role.",
    "General Technology": "Explain the idea, its importance, and its future."
  };

  return {
    ...article,
    category,
    score: total,
    angle: angles[category]
  };
}

async function collectNews() {
  const articles = [];

  for (const source of SOURCES) {
    try {
      console.log(`Reading ${source.name}...`);
      const feed = await parser.parseURL(source.url);

      for (const item of feed.items || []) {
        articles.push({
          source: source.name,
          title: item.title || "Untitled",
          link: item.link || "",
          date: item.isoDate || item.pubDate || "",
          summary: (
            item.contentSnippet ||
            item.summary ||
            "No summary available."
          ).replace(/\s+/g, " ").slice(0, 600)
        });
      }
    } catch (error) {
      console.error(`${source.name}: ${error.message}`);
    }
  }

  const unique = [
    ...new Map(
      articles.filter(a => a.link).map(a => [a.link, a])
    ).values()
  ];

  return unique
    .map(evaluate)
    .sort((a, b) => b.score - a.score)
    .slice(0, 30);
}

async function main() {
  const articles = await collectNews();

  await mkdir("reports", { recursive: true });

  const date = new Date().toISOString().slice(0, 10);

  let report = `# THE HIDDEN ENGINE
## Editorial Intelligence Report

Date: ${date}
Articles analyzed: ${articles.length}

## TOP 5 VIDEO OPPORTUNITIES

`;

  articles.slice(0, 5).forEach((a, i) => {
    report += `### ${i + 1}. ${a.title}

- Score: ${a.score}/100
- Category: ${a.category}
- Source: ${a.source}
- Why it matters: ${a.summary}
- Suggested video angle: ${a.angle}
- Original article: ${a.link}

---

`;
  });

  report += "\n## ALL ANALYZED STORIES\n\n";

  articles.forEach((a, i) => {
    report += `${i + 1}. **${a.title}**
- Score: ${a.score}/100
- Category: ${a.category}
- Source: ${a.source}
- Link: ${a.link}

`;
  });

  await writeFile(
    "reports/weekly-research.md",
    report,
    "utf8"
  );

  console.log(`Editorial report created: ${articles.length} stories.`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
