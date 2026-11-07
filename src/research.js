import Parser from "rss-parser";
import { mkdir, writeFile } from "node:fs/promises";

const parser = new Parser({
  timeout: 15000,
  headers: {
    "User-Agent": "HiddenEngine-Agent/1.0"
  }
});

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
  }
];

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
      console.error(
        `Could not read ${source.name}: ${error.message}`
      );
    }
  }

  return articles
    .filter(article => article.link && article.title)
    .sort((a, b) =>
      new Date(b.date || 0) - new Date(a.date || 0)
    )
    .slice(0, 30);
}

async function main() {
  const articles = await collectNews();

  await mkdir("reports", { recursive: true });

  const date = new Date().toISOString().slice(0, 10);

  let report = `# The Hidden Engine — Research Report

**Date:** ${date}

**Articles collected:** ${articles.length}

---

`;

  if (articles.length === 0) {
    report += "No articles were collected. Check the RSS sources.\n";
  }

  articles.forEach((article, index) => {
    report += `## ${index + 1}. ${article.title}

- **Source:** ${article.source}
- **Date:** ${article.date || "Unknown"}
- **Link:** ${article.link}

**Summary:** ${article.summary}

---

`;
  });

  await writeFile(
    "reports/weekly-research.md",
    report,
    "utf8"
  );

  console.log(`Research complete: ${articles.length} articles.`);
}

main().catch(error => {
  console.error("Research failed:", error);
  process.exit(1);
});
