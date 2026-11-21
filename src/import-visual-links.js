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
  if (!entry || !Array.isArray(entry.visuals) || !entry.visuals.length) throw new Error("No owner-selected visuals for scene " + (i + 1));
  const ids = [];
  for (let j = 0; j < entry.visuals.length; j++) {
    const visual = entry.visuals[j];
    const url = new URL(visual.url);
    if (url.protocol !== "https:") throw new Error("Only HTTPS visual URLs are supported.");
    const id = "OWNER-S" + String(i + 1).padStart(2, "0") + "-V" + String(j + 1).padStart(3, "0");
    assets.push({ id, scene: i + 1, creator: visual.creator || "Not supplied", tags: visual.note || "Owner-selected visual",
      sourcePage: visual.url, directUrl: visual.url, license: visual.license || "Not supplied",
      licenseUrl: visual.licenseUrl || "", illustrative: true, selectionSource: "owner" });
    ids.push(id);
  }
  scenes.push({ scene: i + 1, title: script.scenes[i].title || ("Scene " + (i + 1)), selectedImageIds: ids });
}
await writeFile(path.join(root, "visual-assets.json"), JSON.stringify({ projectId, source: "Owner-supplied visual URLs", assetCount: assets.length, assets }, null, 2) + "\n");
await writeFile(path.join(root, "visual-selection.json"), JSON.stringify({ projectId, title: script.title || projectId, source: "Owner-selected visual URLs", scenes }, null, 2) + "\n");
console.log("Imported " + assets.length + " owner-selected visuals across " + scenes.length + " scenes.");
