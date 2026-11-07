
import express from "express";
import Parser from "rss-parser";

const app = express();
const parser = new Parser();

app.use(express.json());

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

app.get("/health", (req, res) => {
  res.json({
    status: "online",
    agent: "HiddenEngine-Agent"
  });
});

app.get("/api/research", async (req, res) => {
  try {
    const results = await Promise.allSettled(
      SOURCES.map(async (source) => {
        const feed = await parser.parseURL(source.url);

        return feed.items.map((item) => ({
          source: source.name,
          title: item.title || "Untitled",
          link: item.link || "",
          date: item.isoDate || item.pubDate || null,
          summary: (item.contentSnippet || "").slice(0, 500)
        }));
      })
    );

    const articles = results
      .filter((result) => result.status === "fulfilled")
      .flatMap((result) => result.value)
      .sort((a, b) =>
        new Date(b.date || 0) - new Date(a.date || 0)
      );

    res.json({
      success: true,
      count: articles.length,
      articles
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      error: "Research failed"
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`HiddenEngine-Agent running on port ${PORT}`);
});
    
