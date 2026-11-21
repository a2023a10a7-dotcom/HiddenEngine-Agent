import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const projectId = process.env.PROJECT_ID;
if (!projectId || !/^[a-z0-9-]{3,100}$/.test(projectId)) throw new Error("PROJECT_ID missing or invalid.");
const root = path.join("production", "projects", projectId);
const [links, script] = await Promise.all([
  readFile(path.join(root, "visual-links.json"), "utf8").then(JSON.parse),
  readFile(path.join(root, "script.json"), "utf8").then(JSON.parse)
]);
if (!Array.isArray(links.scenes) || links.scenes.length !== script.scenes.length) throw new Error("Visual links must cover every script scene.");
const assets = [], scenes = [];
for (let i = 0; i < script.scenes.length; i++) {
  const entry = links.scenes.find(x => x.scene === i + 1);
  if (!entry || !Array.isArray(entry.visuals) || !entry.visuals.length) throw new Error("No ChatGPT-curated visuals for scene " + (i + 1));
  const ids = [];
  for (let j = 0; j < entry.visuals.length; j++) {
    const visual = entry.visuals[j];
    const page = String(visual.sourcePage || visual.url || "").trim();
    const pageUrl = new URL(page);
    if (pageUrl.protocol !== "https:") throw new Error("Only HTTPS visual source pages are supported.");
    const direct = String(visual.directUrl || (/\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(String(visual.url || "")) ? visual.url : "")).trim();
    if (direct && new URL(direct).protocol !== "https:") throw new Error("Only HTTPS direct image URLs are supported.");
    const id = "CHATGPT-S" + String(i + 1).padStart(2, "0") + "-V" + String(j + 1).padStart(3, "0");
    assets.push({ id, scene: i + 1, creator: visual.creator || "Not supplied", tags: visual.note || "ChatGPT-curated visual",
      sourcePage: page, ...(direct ? { directUrl: direct } : {}), provider: visual.provider || (pageUrl.hostname.endsWith("pixabay.com") ? "Pixabay" : "Web source"),
      license: visual.license || "Not supplied", licenseUrl: visual.licenseUrl || "", illustrative: true, selectionSource: "ChatGPT-curated" });
    ids.push(id);
  }
  scenes.push({ scene: i + 1, title: script.scenes[i].title || ("Scene " + (i + 1)), selectedImageIds: ids });
}
await writeFile(path.join(root, "visual-assets.json"), JSON.stringify({ projectId, source: "ChatGPT-curated visual sources", assetCount: assets.length, assets }, null, 2) + "\n");
await writeFile(path.join(root, "visual-selection.json"), JSON.stringify({ projectId, title: script.title || projectId, source: "ChatGPT-curated visual source pages", scenes }, null, 2) + "\n");
console.log("Imported " + assets.length + " ChatGPT-curated visuals across " + scenes.length + " scenes.");
