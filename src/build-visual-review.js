import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const projectId = process.env.PROJECT_ID;
const apiKey = process.env.PIXABAY_API_KEY;
if (!projectId || !/^[a-z0-9-]+$/.test(projectId)) throw new Error("PROJECT_ID missing or invalid");
if (!apiKey) throw new Error("PIXABAY_API_KEY is required for free stock-image discovery");
const root = path.join("production", "projects", projectId);
const reviewRound = process.env.VISUAL_REVIEW_ROUND || "round-2";
if (!/^[a-z0-9-]+$/.test(reviewRound)) throw new Error("VISUAL_REVIEW_ROUND is invalid");
const out = path.join("dist", projectId, "visual-review-" + reviewRound);
const maxPerScene = Math.max(4, Math.min(12, Number.parseInt(process.env.CANDIDATES_PER_SCENE || "8", 10) || 8));
const maxTotal = Math.max(20, Math.min(90, Number.parseInt(process.env.MAX_CANDIDATES || "60", 10) || 60));
const timeout = ms => AbortSignal.timeout(ms);

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const p = spawn(command, args, { stdio: "inherit" });
    p.on("error", reject);
    p.on("close", code => code === 0 ? resolve() : reject(new Error(command + " exited " + code)));
  });
}
async function searchImages(query, perPage = 20) {
  const url = "https://pixabay.com/api/?key=" + encodeURIComponent(apiKey) +
    "&q=" + encodeURIComponent(query) + "&image_type=photo&orientation=horizontal&safesearch=true&per_page=" + perPage;
  const response = await fetch(url, { signal: timeout(20000) });
  if (!response.ok) throw new Error("Pixabay search failed (" + response.status + ")");
  const data = await response.json();
  return (data.hits || []).filter(x => x.webformatURL && x.largeImageURL && x.pageURL)
    .map(x => ({ page: x.pageURL, preview: x.webformatURL, image: x.largeImageURL,
      creator: x.user || "Pixabay contributor", tags: x.tags || "",
      width: x.imageWidth || 0, height: x.imageHeight || 0 }));
}
async function download(url, file) {
  const response = await fetch(url, { signal: timeout(30000) });
  if (!response.ok) throw new Error("Image download failed (" + response.status + ")");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 15 * 1024 * 1024) throw new Error("Invalid or oversized image");
  await writeFile(file, bytes);
}
function safeName(value) { return String(value).replace(/[^a-z0-9-]/gi, "-").slice(0, 50); }

async function main() {
  const script = JSON.parse(await readFile(path.join(root, "script.json"), "utf8"));
  if (!Array.isArray(script.scenes) || !script.scenes.length) throw new Error("script.json has no scenes");
  await mkdir(out, { recursive: true });
  const candidates = [], seen = new Set();
  for (let i = 0; i < script.scenes.length && candidates.length < maxTotal; i++) {
    const scene = script.scenes[i];
    const queries = [...new Set((Array.isArray(scene.visual_queries) ? scene.visual_queries : [])
      .concat(scene.visual_query || [], [scene.title, scene.subtitle].filter(Boolean))
      .map(x => String(x).trim()).filter(Boolean))].slice(0, 4);
    const sceneItems = [];
    for (const query of queries) {
      if (sceneItems.length >= maxPerScene || candidates.length >= maxTotal) break;
      let hits = [];
      try { hits = await searchImages(query, 20); }
      catch (error) { console.warn("Scene " + (i+1) + " query failed: " + error.message); continue; }
      for (const hit of hits) {
        if (sceneItems.length >= maxPerScene || candidates.length >= maxTotal) break;
        if (seen.has(hit.page)) continue;
        seen.add(hit.page);
        const id = "I" + String(candidates.length + 1).padStart(3, "0");
        const file = path.join(out, id + ".jpg");
        try { await download(hit.preview, file); }
        catch (error) { console.warn(id + " skipped: " + error.message); continue; }
        const item = { id, scene: i+1, sceneTitle: scene.title || "Scene " + (i+1),
          query, creator: hit.creator, tags: hit.tags, width: hit.width, height: hit.height,
          sourcePage: hit.page, previewFile: id + ".jpg", license: "Pixabay Content License",
          licenseUrl: "https://pixabay.com/service/license-summary/" };
        sceneItems.push(item); candidates.push(item);
      }
    }
    console.log("Scene " + (i+1) + ": " + sceneItems.length + " candidate images");
  }
  if (!candidates.length) throw new Error("No candidate images were found; check Pixabay secret and queries");

  const selection = {
    projectId, instructions: "Choose image IDs per scene. Keep only IDs you approve. You may choose 1-4 per scene; leave an empty array to request a different search. Do not edit sourcePage fields.",
    scenes: script.scenes.map((s,i) => ({ scene: i+1, title: s.title || "", selectedImageIds: [] }))
  };
  await writeFile(path.join(out, "visual-candidates.json"), JSON.stringify({ projectId, total: candidates.length, candidates }, null, 2) + "\n");
  await writeFile(path.join(out, "selection-template.json"), JSON.stringify(selection, null, 2) + "\n");
  const aiBrief = [
    "# HiddenEngine — Visual Editor Brief", "",
    "Review the attached contact sheets and visual-candidates.json. The image labels are IDs.",
    "Choose only images that concretely match each scene narration. Reject generic AI/technology imagery, misleading event imagery, and weak thematic matches.",
    "Do not invent sources, identities, dates, or claims. Stock images are illustrative, not evidence of a named event.",
    "Return the completed selection-template.json structure with 1–4 approved image IDs per scene, plus a short rationale for each choice.",
    "If none is appropriate, return an empty array for that scene and suggest precise search phrases.", "",
    "## Documentary script", "",
    "Title: " + (script.title || projectId), "",
    ...script.scenes.map((s,i) => ["### Scene " + (i+1) + ": " + (s.title || ""),
      s.subtitle || "", "", s.narration || "", "", "Search intent: " + (s.visual_queries || []).join("; ")].join("\n"))
  ].join("\n");
  await writeFile(path.join(out, "SCRIPT-FOR-AI.md"), aiBrief + "\n");

  const perSheet = 20, sheetCount = Math.ceil(candidates.length / perSheet);
  for (let page = 0; page < sheetCount; page++) {
    const group = candidates.slice(page * perSheet, (page+1) * perSheet);
    const cellW = 320, cellH = 180, labelH = 34, cols = 4, rows = 5, gap = 8, margin = 8;
    const width = margin*2 + cols*cellW + (cols-1)*gap;
    const height = margin*2 + rows*(cellH+labelH) + (rows-1)*gap;
    const cells = [];
    for (let i = 0; i < group.length; i++) {
      const item = group[i], x = margin+(i%cols)*(cellW+gap), y = margin+Math.floor(i/cols)*(cellH+labelH+gap);
      const bytes = await readFile(path.join(out,item.previewFile));
      const encoded = bytes.toString("base64");
      cells.push('<rect x="'+x+'" y="'+y+'" width="'+cellW+'" height="'+(cellH+labelH)+'" fill="#171717"/>');
      cells.push('<image x="'+x+'" y="'+y+'" width="'+cellW+'" height="'+cellH+'" preserveAspectRatio="xMidYMid meet" href="data:image/jpeg;base64,'+encoded+'"/>');
      cells.push('<text x="'+(x+10)+'" y="'+(y+cellH+24)+'" fill="#ffffff" font-family="DejaVu Sans, sans-serif" font-size="18" font-weight="bold">'+item.id+'  |  SCENE '+item.scene+'</text>');
    }
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'" viewBox="0 0 '+width+' '+height+'"><rect width="100%" height="100%" fill="#08090b"/>'+cells.join("")+'</svg>';
    const svgPath = path.join(out,"CONTACT-SHEET-"+(page+1)+".svg");
    await writeFile(svgPath,svg);
    const pngPath = path.join(out,"CONTACT-SHEET-"+(page+1)+".png");
    await run("rsvg-convert",["-f","png","-o",pngPath,svgPath]);
    await run("ffmpeg",["-y","-i",pngPath,"-frames:v","1","-q:v","2",path.join(out,"CONTACT-SHEET-"+(page+1)+".jpg")]);
  }
  console.log("Visual review package ready: " + candidates.length + " images across " + sheetCount + " contact sheets.");
}
main().catch(error => { console.error(error); process.exit(1); });
