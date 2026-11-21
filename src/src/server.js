import express from "express";
import Parser from "rss-parser";
const app = express();
const parser = new Parser();
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));
const SOURCES = [
  { name: "TechCrunch", url: "https://techcrunch.com/feed/" },
  { name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index" },
  { name: "The Verge", url: "https://www.theverge.com/rss/index.xml" }
];
const REPOSITORY = process.env.GITHUB_REPOSITORY || "a2023a10a7-dotcom/HiddenEngine-Agent";
const BRANCH = process.env.GITHUB_BRANCH || "main";
const API_ROOT = "https://api.github.com/repos/" + REPOSITORY;
function validProjectId(value) { return typeof value === "string" && /^[a-z0-9-]{3,100}$/.test(value); }
async function githubRequest(url, options = {}) {
  if (!process.env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN is not configured on the server.");
  const response = await fetch(url, {
    ...options,
    headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + process.env.GITHUB_TOKEN,
      "X-GitHub-Api-Version": "2022-11-28", ...(options.headers || {}) },
    signal: AbortSignal.timeout(30000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(body.message || "GitHub API request failed (" + response.status + ")."); error.status = response.status; throw error; }
  return body;
}
function decodeGithubFile(file) { return Buffer.from(String(file.content || "").replace(/\n/g, ""), "base64").toString("utf8"); }
function requireEditor(req, res, next) {
  const expected = process.env.EDITOR_PASSWORD;
  if (!expected) return res.status(503).json({ success: false, error: "Set EDITOR_PASSWORD on the hosting service before saving." });
  if (req.get("x-editor-password") !== expected) return res.status(401).json({ success: false, error: "كلمة مرور التحرير غير صحيحة." });
  next();
}
app.get("/health", (req, res) => res.json({ status: "online", agent: "HiddenEngine-Agent" }));
app.get("/api/projects/:projectId/scenes", async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!validProjectId(projectId)) return res.status(400).json({ success: false, error: "Invalid project ID." });
    const file = await githubRequest(API_ROOT + "/contents/production/projects/" + projectId + "/script.json?ref=" + encodeURIComponent(BRANCH));
    const script = JSON.parse(decodeGithubFile(file));
    res.json({ success: true, projectId, title: script.title || projectId,
      scenes: (script.scenes || []).map((scene, index) => ({ scene: index + 1, title: scene.title || scene.act || ("Scene " + (index + 1)), narration: String(scene.narration || "").slice(0, 260) })) });
  } catch (error) { res.status(error.status || 500).json({ success: false, error: error.message }); }
});
app.get("/api/projects/:projectId/visual-links", async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!validProjectId(projectId)) return res.status(400).json({ success: false, error: "Invalid project ID." });
    const file = await githubRequest(API_ROOT + "/contents/production/projects/" + projectId + "/visual-links.json?ref=" + encodeURIComponent(BRANCH));
    res.json({ success: true, data: JSON.parse(decodeGithubFile(file)) });
  } catch (error) {
    if (error.status === 404) return res.json({ success: true, data: null });
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});
app.post("/api/projects/:projectId/visual-links", requireEditor, async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!validProjectId(projectId)) return res.status(400).json({ success: false, error: "Invalid project ID." });
    const scenes = req.body?.scenes;
    if (!Array.isArray(scenes) || !scenes.length) return res.status(400).json({ success: false, error: "أضف روابط المرئيات." });
    const scriptFile = await githubRequest(API_ROOT + "/contents/production/projects/" + projectId + "/script.json?ref=" + encodeURIComponent(BRANCH));
    const script = JSON.parse(decodeGithubFile(scriptFile));
    const sceneCount = (script.scenes || []).length;
    const normalized = scenes.map(item => {
      const scene = Number(item.scene);
      if (!Number.isInteger(scene) || scene < 1 || scene > sceneCount) throw new Error("رقم المشهد غير صالح: " + item.scene);
      const visuals = (Array.isArray(item.visuals) ? item.visuals : []).map(v => {
        const url = String(v.url || "").trim();
        let parsed;
        try { parsed = new URL(url); } catch { throw new Error("رابط غير صالح في المشهد " + scene); }
        if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) throw new Error("استخدم رابط HTTPS عاماً وآمناً.");
        return { url, creator: String(v.creator || "").trim(), license: String(v.license || "").trim(),
          licenseUrl: String(v.licenseUrl || "").trim(), note: String(v.note || "").trim() };
      });
      if (!visuals.length) throw new Error("أضف رابطاً واحداً على الأقل للمشهد " + scene);
      return { scene, title: script.scenes[scene - 1].title || script.scenes[scene - 1].act || ("Scene " + scene), visuals };
    });
    const document = { schemaVersion: "1.0.0", projectId, updatedAt: new Date().toISOString(),
      selectionMode: "owner_selected_urls", note: "Owner supplied URLs; verify source accuracy and usage rights before publication.", scenes: normalized };
    const filePath = "production/projects/" + projectId + "/visual-links.json";
    let sha;
    try { sha = (await githubRequest(API_ROOT + "/contents/" + filePath + "?ref=" + encodeURIComponent(BRANCH))).sha; }
    catch (error) { if (error.status !== 404) throw error; }
    const saved = await githubRequest(API_ROOT + "/contents/" + filePath, { method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Save owner-selected visual links for " + projectId,
        content: Buffer.from(JSON.stringify(document, null, 2) + "\n", "utf8").toString("base64"), branch: BRANCH, ...(sha ? { sha } : {}) }) });
    res.json({ success: true, message: "تم حفظ الروابط في GitHub.", file: filePath, commit: saved.commit?.sha || null });
  } catch (error) { res.status(error.status || 500).json({ success: false, error: error.message }); }
});
app.get("/api/research", async (req, res) => {
  const results = await Promise.allSettled(SOURCES.map(async source => {
    const feed = await parser.parseURL(source.url);
    return feed.items.map(item => ({ source: source.name, title: item.title || "Untitled", link: item.link || "",
      date: item.isoDate || item.pubDate || null, summary: (item.contentSnippet || "").slice(0, 500) }));
  }));
  const articles = results.filter(x => x.status === "fulfilled").flatMap(x => x.value).sort((a,b) => new Date(b.date || 0)-new Date(a.date || 0));
  res.json({ success: true, count: articles.length, articles });
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log("HiddenEngine-Agent running on port " + PORT));
