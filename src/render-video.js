import { access, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const PROJECT_ID = process.env.PROJECT_ID;
if (!PROJECT_ID || !/^[a-z0-9-]+$/.test(PROJECT_ID)) throw new Error("PROJECT_ID is missing or invalid.");
const ROOT = path.join("production", "projects", PROJECT_ID);
const OUT = path.join("dist", PROJECT_ID);
const PEXELS_API_KEY = process.env.PEXELS_API_KEY;
const SCENE_DURATION_SECONDS = 8;

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error(command + " exited with code " + code)));
  });
}

async function capture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", d => stdout += d);
    child.stderr.on("data", d => stderr += d);
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(command + " exited with code " + code + ": " + stderr.slice(-1200))));
  });
}
function xml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&apos;" })[c]);
}
function lines(value, max = 34) {
  const out = []; let line = "";
  for (const word of String(value).split(/\s+/)) {
    if (line && (line + " " + word).length > max) { out.push(line); line = word; }
    else line = line ? line + " " + word : word;
  }
  if (line) out.push(line);
  return out;
}

function visualMarkup(scene) {
  const v = scene.visual;
  if (!v || !v.type) return "";
  const label = xml(v.source_label || "SOURCE NOT VERIFIED");
  if (v.type === "metric") {
    return '<g transform="translate(1220 360)"><rect width="560" height="260" rx="8" fill="#111315" stroke="#A8794D" stroke-width="2"/><text x="36" y="54" class="visual-label">' + label + '</text><text x="36" y="166" class="visual-value">' + xml(v.value) + '</text><text x="36" y="218" class="visual-detail">' + xml(v.detail || "") + '</text></g>';
  }
  if (v.type === "comparison" && Array.isArray(v.items)) {
    const rows = v.items.slice(0,3).map((item,i) => {
      const y=92+i*72, width=Math.max(0,Math.min(100,Number(item.percent)||0))*3.8;
      return '<text x="32" y="'+y+'" class="visual-detail">'+xml(item.label)+'</text><rect x="32" y="'+(y+14)+'" width="380" height="16" fill="#292b2d"/><rect x="32" y="'+(y+14)+'" width="'+width+'" height="16" fill="#A8794D"/><text x="430" y="'+(y+29)+'" class="visual-detail">'+xml(item.value)+'</text>';
    }).join("");
    return '<g transform="translate(1190 330)"><rect width="590" height="330" rx="8" fill="#111315" stroke="#A8794D" stroke-width="2"/><text x="32" y="52" class="visual-label">'+label+'</text>'+rows+'</g>';
  }
  if (v.type === "timeline" && Array.isArray(v.events)) {
    const events=v.events.slice(0,4).map((item,i) => {
      const x=42+i*132;
      return '<circle cx="'+x+'" cy="150" r="8" fill="#C08A58"/><text x="'+x+'" y="116" text-anchor="middle" class="visual-label">'+xml(item.date)+'</text><text x="'+x+'" y="184" text-anchor="middle" class="visual-detail">'+xml(item.label)+'</text>';
    }).join("");
    return '<g transform="translate(1060 390)"><rect width="650" height="250" rx="8" fill="#111315" stroke="#A8794D" stroke-width="2"/><text x="34" y="48" class="visual-label">'+label+'</text><path d="M42 150 H570" stroke="#777" stroke-width="3"/>'+events+'</g>';
  }
  if (v.type === "map" && Array.isArray(v.points) && v.points.length >= 2) {
    const points = v.points.slice(0,8).filter(p => Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)));
    if (points.length >= 2) {
      const coords = points.map(p => (80 + Math.max(0,Math.min(100,Number(p.x)))*4.8) + "," + (80 + Math.max(0,Math.min(100,Number(p.y)))*3.2)).join(" ");
      const pins = points.map((p,i) => {
        const x=80+Math.max(0,Math.min(100,Number(p.x)))*4.8, y=80+Math.max(0,Math.min(100,Number(p.y)))*3.2;
        return '<circle cx="'+x+'" cy="'+y+'" r="13" fill="#C08A58" stroke="#F0EDE5" stroke-width="3"/><text x="'+(x+20)+'" y="'+(y-16)+'" class="visual-detail">'+xml(p.label || ("Point "+(i+1)))+'</text>';
      }).join("");
      return '<g transform="translate(1050 300)"><rect width="720" height="570" rx="8" fill="#111315" stroke="#A8794D" stroke-width="2"/><text x="34" y="48" class="visual-label">'+label+'</text><path d="M30 120 Q180 80 300 180 T690 250 M60 450 Q240 350 380 430 T680 500" fill="none" stroke="#34383A" stroke-width="5"/><polyline points="'+coords+'" fill="none" stroke="#C08A58" stroke-width="5" stroke-dasharray="12 10"/>'+pins+'</g>';
    }
  }
  return "";
}

function titleOverlaySvg(scene) {
  const title = lines((scene.title || "").toUpperCase(), 28).slice(0, 2)
    .map((value, i) => '<text x="154" y="' + (760 + i*76) + '" class="title">' + xml(value) + '</text>').join("");
  const subtitle = lines(scene.subtitle || "", 58).slice(0, 2)
    .map((value, i) => '<text x="158" y="' + (930 + i*38) + '" class="sub">' + xml(value) + '</text>').join("");
  return '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">' +
    '<path d="M112 690 V674 H1780 V1012 H112 V982 M112 690 H130 M1762 674 H1780 V692 M1762 1012 H1780 V994" fill="none" stroke="#A8794D" stroke-width="3" opacity=".9"/>' +
    '<path d="M112 710 V674 H380" fill="none" stroke="#F0EDE5" stroke-width="5"/>' + title + subtitle +
    '<style>.title{font:700 64px DejaVu Sans;fill:#F0EDE5}.sub{font:400 27px DejaVu Sans;fill:#D5D1C8}</style></svg>';
}
function overlaySvg(scene, index, total) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">
  <defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#08090b" stop-opacity=".25"/><stop offset=".48" stop-color="#08090b" stop-opacity=".05"/><stop offset="1" stop-color="#08090b" stop-opacity=".92"/></linearGradient></defs>
  <rect width="1920" height="1080" fill="url(#shade)"/>
  <rect x="120" y="112" width="7" height="68" fill="#A8794D"/>
  <text x="154" y="145" class="brand">THE HIDDEN ENGINE</text>
  <text x="154" y="180" class="kicker">BUSINESS • STRATEGY • THE HIDDEN ECONOMICS</text>
  <text x="120" y="710" class="eyebrow">THE INVESTIGATION / ${String(index+1).padStart(2,"0")}</text>
  ${visualMarkup(scene)}\n  <text x="1795" y="1010" text-anchor="end" class="page">${String(index+1).padStart(2,"0")} / ${total}</text>
  <style>
  .brand{font:700 30px 'DejaVu Sans';letter-spacing:6px;fill:#F0EDE5}
  .kicker{font:400 17px 'DejaVu Sans';letter-spacing:3px;fill:#C3B7A8}
  .eyebrow{font:700 18px 'DejaVu Sans';letter-spacing:4px;fill:#C08A58}
  .title{font:700 64px 'DejaVu Sans';fill:#F0EDE5}
  .sub{font:400 27px 'DejaVu Sans';fill:#D5D1C8}
  .visual-label{font:700 18px DejaVu Sans;letter-spacing:2px;fill:#C08A58}
  .visual-value{font:700 82px DejaVu Sans;fill:#F0EDE5}
  .visual-detail{font:400 20px DejaVu Sans;fill:#D5D1C8}
  .page{font:400 20px 'DejaVu Sans';fill:#D5D1C8}
  </style></svg>`;
}
const PIXABAY_API_KEY = process.env.PIXABAY_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const PIPER_EXECUTABLE = process.env.PIPER_EXECUTABLE || "piper";
const PIPER_MODEL = process.env.PIPER_MODEL || "models/piper-voice.onnx";
const PIPER_LENGTH_SCALE = Number(process.env.PIPER_LENGTH_SCALE || "1.0");
const USED_ASSET_PAGES = new Set();

function relevanceScore(query, tags) {
  const stop = new Set(["with","from","that","this","into","over","under","about","computer","image","video","photo"]);
  const terms = [...new Set(String(query || "").toLowerCase().match(/[a-z0-9]{3,}/g) || [])].filter(t => !stop.has(t));
  const tagSet = new Set(String(tags || "").toLowerCase().split(/[,; ]+/).filter(Boolean));
  if (!terms.length) return 0;
  const matched = terms.filter(term => [...tagSet].some(tag => tag === term || (term.length >= 5 && tag.includes(term)) || (tag.length >= 5 && term.includes(tag))));
  const needed = 1;
return matched.length >= needed ? Math.max(0.5, matched.length / terms.length) : 0;
}

async function findPixabayVideo(query) {
  if (!PIXABAY_API_KEY || !String(query || "").trim()) return null;
  const endpoint = "https://pixabay.com/api/videos/?key=" + encodeURIComponent(PIXABAY_API_KEY) +
    "&q=" + encodeURIComponent(query) + "&safesearch=true&per_page=20";
  const response = await fetchWithTimeout(endpoint, {}, 15000);
  if (!response.ok) throw new Error("Pixabay video search failed (" + response.status + ").");
  const data = await response.json();
  const hits = (data.hits || []).map(hit => ({hit, score: relevanceScore(query, hit.tags)}))
    .filter(item => item.score >= 0.5 && item.hit.videos && !USED_ASSET_PAGES.has(item.hit.pageURL));
  hits.sort((a,b) => b.score-a.score || (b.hit.videos.large?.width || 0) - (a.hit.videos.large?.width || 0));
  for (const {hit} of hits) {
    const files = Object.values(hit.videos || {}).filter(v => v && v.url && v.width >= 960).sort((a,b) => b.width-a.width);
    const video = files[0] || Object.values(hit.videos || {}).find(v => v?.url);
    if (!video) continue;
    return {url:video.url,page:hit.pageURL,creator:hit.user||"Pixabay contributor",creatorUrl:"",duration:hit.duration,provider:"Pixabay video",tags:hit.tags};
  }
  console.log("Pixabay video search returned no sufficiently relevant result for: " + query);
  return null;
}

async function findPixabayImage(query) {
  if (!PIXABAY_API_KEY || !String(query || "").trim()) return null;
  const endpoint = "https://pixabay.com/api/?key=" + encodeURIComponent(PIXABAY_API_KEY) +
    "&q=" + encodeURIComponent(query) + "&image_type=photo&orientation=horizontal&safesearch=true&per_page=20";
  const response = await fetchWithTimeout(endpoint, {}, 15000);
  if (!response.ok) throw new Error("Pixabay image search failed (" + response.status + ").");
  const data = await response.json();
  const hits = (data.hits || []).map(hit => ({hit, score: relevanceScore(query, hit.tags)}))
    .filter(item => item.score >= 0.5 && item.hit.largeImageURL && !USED_ASSET_PAGES.has(item.hit.pageURL));
  hits.sort((a,b) => b.score-a.score || (b.hit.imageWidth*b.hit.imageHeight)-(a.hit.imageWidth*a.hit.imageHeight));
  const best = hits[0]?.hit;
  if (!best) {
    console.log("Pixabay image search returned no sufficiently relevant result for: " + query);
    return null;
  }
  return {url:best.largeImageURL,page:best.pageURL,creator:best.user||"Pixabay contributor",creatorUrl:"",provider:"Pixabay photo",license:"Pixabay Content License",tags:best.tags};
}

async function findPixabayImageCandidates(query, limit = 8) {
  if (!PIXABAY_API_KEY || !String(query || "").trim()) return [];
  const endpoint = "https://pixabay.com/api/?key=" + encodeURIComponent(PIXABAY_API_KEY) +
    "&q=" + encodeURIComponent(query) + "&image_type=photo&orientation=horizontal&safesearch=true&per_page=" + limit;
  const response = await fetchWithTimeout(endpoint, {}, 15000);
  if (!response.ok) throw new Error("Pixabay image search failed (" + response.status + ").");
  const data = await response.json();
  return (data.hits || []).filter(hit => hit.webformatURL && hit.largeImageURL && !USED_ASSET_PAGES.has(hit.pageURL)).slice(0, limit).map(hit => ({
    url: hit.largeImageURL, previewUrl: hit.webformatURL, page: hit.pageURL,
    creator: hit.user || "Pixabay contributor", provider: "Pixabay photo",
    license: "Pixabay Content License", tags: hit.tags || "", width: hit.imageWidth || 0, height: hit.imageHeight || 0
  }));
}

async function selectImageWithGemini(narration, sceneTitle, sceneSubtitle, query, candidates) {
  if (!GEMINI_API_KEY || !Array.isArray(candidates) || !candidates.length) return null;
  const prepared = [];
  for (let i = 0; i < candidates.length; i++) {
    try {
      const response = await fetchWithTimeout(candidates[i].previewUrl, {}, 12000);
      if (!response.ok) continue;
      const mimeType = (response.headers.get("content-type") || "image/jpeg").split(";")[0];
      if (!/^image\/(jpeg|png|webp)$/i.test(mimeType)) continue;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.length > 5 * 1024 * 1024) continue;
      prepared.push({ index: i + 1, candidate: candidates[i], mimeType, data: bytes.toString("base64") });
    } catch (error) { console.warn("Could not prepare Gemini candidate " + (i + 1) + ": " + error.message); }
  }
  if (!prepared.length) return null;
  const prompt = [
    "You are the visual editor of a high-quality factual documentary.",
    "Inspect the actual image pixels and choose the image that most accurately illustrates the narration.",
    "Do not choose based only on tags, filenames, or search query. Prefer specific concrete visual relevance.",
    "Reject generic technology imagery, unrelated stock photos, misleading historical imagery, and broad thematic matches.",
    "Stock imagery is illustrative, never proof of a named person, company, or real event.",
    "If no image is genuinely relevant, return choice 0.",
    "Return ONLY JSON: {\"choice\": integer, \"confidence\": integer, \"relevance_score\": integer, \"reason\": \"short explanation\"}.",
    "A choice is acceptable only when confidence and relevance_score are both at least 85.",
    "Scene title: " + String(sceneTitle || ""),
    "Scene subtitle: " + String(sceneSubtitle || ""),
    "Search phrase (context only): " + String(query || ""),
    "Narration: " + String(narration || ""),
    "Candidate numbers match attached images in this order: " + prepared.map(x => x.index).join(", ")
  ].join("\n");
  const parts = [{ text: prompt }];
  for (const item of prepared) {
    parts.push({ text: "Candidate " + item.index });
    parts.push({ inline_data: { mime_type: item.mimeType, data: item.data } });
  }
  const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(GEMINI_MODEL) + ":generateContent?key=" + encodeURIComponent(GEMINI_API_KEY);
  const response = await fetchWithTimeout(endpoint, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { temperature: 0, responseMimeType: "application/json" } })
  }, 45000);
  if (!response.ok) throw new Error("Gemini image selection failed (" + response.status + "): " + (await response.text()).slice(0, 700));
  const payload = await response.json();
  const answer = (payload.candidates && payload.candidates[0] && payload.candidates[0].content && payload.candidates[0].content.parts || []).map(part => part.text || "").join("").trim();
  if (!answer) throw new Error("Gemini returned an empty image-selection response.");
  let decision;
  try { decision = JSON.parse(answer.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
  catch { throw new Error("Gemini returned invalid JSON: " + answer.slice(0, 300)); }
  const choice = Number(decision.choice), confidence = Number(decision.confidence), relevance = Number(decision.relevance_score);
  if (!Number.isInteger(choice) || choice < 1 || choice > prepared.length || confidence < 85 || relevance < 85) {
    console.log("Gemini rejected all image candidates: " + String(decision.reason || "No sufficiently relevant image."));
    return null;
  }
  const selected = prepared.find(item => item.index === choice);
  if (!selected) return null;
  console.log("Gemini selected Pixabay image " + choice + " (confidence " + confidence + ", relevance " + relevance + "): " + String(decision.reason || ""));
  return Object.assign({}, selected.candidate, { semanticConfidence: confidence, semanticRelevance: relevance, semanticReason: String(decision.reason || "") });
}
async function selectSceneVisualWithGemini(scene, sceneNumber) {
  if (!GEMINI_API_KEY) return scene.visual || null;
  const prompt = [
    "Act as a senior documentary visual editor and motion-graphics director.",
    "Decide whether this narration segment needs a graphic, chart, timeline, comparison, or schematic map, and at which scene it belongs.",
    "Return one JSON object only, matching this schema: {\"type\":\"none|metric|comparison|timeline|map\",\"source_label\":\"short label\",\"value\":\"...\",\"detail\":\"...\",\"items\":[{\"label\":\"...\",\"percent\":0,\"value\":\"...\"}],\"events\":[{\"date\":\"...\",\"label\":\"...\"}],\"points\":[{\"x\":0,\"y\":0,\"label\":\"...\"}],\"reason\":\"...\"}.",
    "Choose none for ordinary narration, abstract claims, or when a graphic would add no clear understanding. Do not force a graphic into every scene.",
    "Use metric only for a single explicit numeric finding; comparison only for two or more explicit comparable values; timeline only for two or more explicit dated/ordered events; map only when the narration explicitly concerns at least two named geographic places, movement, borders, routes, or spatial relationships.",
    "Never invent numbers, percentages, dates, events, geographic places, or causal claims. Use only facts explicitly present in narration, subtitle, or existing visual data supplied below.",
    "If the facts are insufficient to populate a visual accurately, choose none.",
    "For map points, x and y are schematic layout positions from 0 to 100, not geographic coordinates. Label only explicitly named places. A schematic map must not imply precise geography.",
    "Keep labels concise and readable. Avoid repeating the narration. source_label must identify the source or say DOCUMENTARY EXPLANATION when no external source is supplied.",
    "Scene number: " + sceneNumber,
    "Title: " + String(scene.title || ""),
    "Subtitle: " + String(scene.subtitle || ""),
    "Narration: " + String(scene.narration || ""),
    "Existing visual data (may be retained only if factually supported): " + JSON.stringify(scene.visual || null)
  ].join("\n");
  const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(GEMINI_MODEL) + ":generateContent?key=" + encodeURIComponent(GEMINI_API_KEY);
  const response = await fetchWithTimeout(endpoint, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0, responseMimeType: "application/json" } })
  }, 35000);
  if (!response.ok) throw new Error("Gemini visual-planning request failed (" + response.status + "): " + (await response.text()).slice(0, 500));
  const payload = await response.json();
  const answer = (payload.candidates && payload.candidates[0] && payload.candidates[0].content && payload.candidates[0].content.parts || []).map(part => part.text || "").join("").trim();
  if (!answer) throw new Error("Gemini returned an empty visual-planning response for scene " + sceneNumber);
  let visual;
  try { visual = JSON.parse(answer.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
  catch { throw new Error("Gemini returned invalid visual JSON for scene " + sceneNumber + ": " + answer.slice(0, 300)); }
  const allowed = new Set(["none", "metric", "comparison", "timeline", "map"]);
  if (!allowed.has(visual.type)) throw new Error("Gemini returned unsupported visual type for scene " + sceneNumber);
  if (visual.type === "metric" && (!String(visual.value || "").trim() || !String(visual.detail || "").trim())) visual.type = "none";
  if (visual.type === "comparison" && (!Array.isArray(visual.items) || visual.items.length < 2)) visual.type = "none";
  if (visual.type === "timeline" && (!Array.isArray(visual.events) || visual.events.length < 2)) visual.type = "none";
  if (visual.type === "map" && (!Array.isArray(visual.points) || visual.points.length < 2 || visual.points.some(p => !Number.isFinite(Number(p.x)) || !Number.isFinite(Number(p.y)) || !String(p.label || "").trim()))) visual.type = "none";
  if (visual.type === "none") { console.log("Gemini chose no graphic for scene " + sceneNumber + ": " + String(visual.reason || "No useful factual visual.")); return null; }
  console.log("Gemini planned " + visual.type + " graphic for scene " + sceneNumber + ": " + String(visual.reason || ""));
  return visual;
}
async function findPexelsImage(query) {
  if (!PEXELS_API_KEY || !String(query || "").trim()) return null;
  const endpoint = "https://api.pexels.com/v1/search?query=" + encodeURIComponent(query) + "&orientation=landscape&per_page=8";
  const response = await fetchWithTimeout(endpoint,{headers:{Authorization:PEXELS_API_KEY}});
  if (!response.ok) throw new Error("Pexels photo search failed ("+response.status+"): "+(await response.text()).slice(0,300));
  const data=await response.json();
  const photos=(data.photos||[]).filter(p=>p.src && (p.src.landscape||p.src.large2x||p.src.large) && !USED_ASSET_PAGES.has(p.url));
  photos.sort((a,b)=>(b.width*b.height)-(a.width*a.height));
  const p=photos[0];
  return p ? {url:p.src.landscape||p.src.large2x||p.src.large,page:p.url,creator:p.photographer||"Unknown creator",creatorUrl:p.photographer_url||"",provider:"Pexels photo"} : null;
}
async function findCommonsImage(query) {
  const raw = String(query || "").trim();
  if (!raw) return null;
  const allowed = /^(CC0|Public domain|CC BY(?:-SA)? \d)/i;
  const clean = value => String(value || "").replace(/<[^>]*>/g,"").replace(/&nbsp;/g," ").trim();
  const endpoint = "https://commons.wikimedia.org/w/api.php?action=query&list=search&srnamespace=6&srlimit=30&srsearch=" +
    encodeURIComponent(raw) + "&format=json";
  const response = await fetchWithTimeout(endpoint, {
    headers: { "User-Agent": "HiddenEngineDocumentaryBot/1.0 (asset attribution and license verification)" }
  });
  if (!response.ok) throw new Error("Wikimedia Commons search failed ("+response.status+").");
  const data = await response.json();
  const titles = (data.query?.search || []).map(item => item.title).filter(Boolean);
  if (!titles.length) return null;
  const detailsUrl = "https://commons.wikimedia.org/w/api.php?action=query&titles=" +
    encodeURIComponent(titles.join("|")) + "&prop=imageinfo&iiprop=url|mime|extmetadata&iiurlwidth=1920&format=json";
  const detailsResponse = await fetchWithTimeout(detailsUrl, {
    headers: { "User-Agent": "HiddenEngineDocumentaryBot/1.0 (asset attribution and license verification)" }
  });
  if (!detailsResponse.ok) throw new Error("Wikimedia Commons image details failed ("+detailsResponse.status+").");
  const details = await detailsResponse.json();
  const candidates = Object.values(details.query?.pages || {}).map(page => {
    const info = page.imageinfo?.[0];
    if (!info || !/^image\/(jpeg|png|webp)$/i.test(info.mime || "")) return null;
    const meta = info.extmetadata || {};
    const license = clean(meta.LicenseShortName?.value);
    if (!allowed.test(license)) return null;
    const tags = page.title + " " + clean(meta.ImageDescription?.value);
    return {page,info,meta,license,score:relevanceScore(raw,tags)};
  }).filter(item => item && item.score >= 0.5 && !USED_ASSET_PAGES.has(item.info.descriptionurl));
  candidates.sort((a,b)=>b.score-a.score);
  const best = candidates[0];
  if (!best) return null;
  return {
    url: best.info.thumburl || best.info.url,
    page: best.info.descriptionurl || ("https://commons.wikimedia.org/wiki/" + encodeURIComponent(best.page.title.replace(/ /g,"_"))),
    creator: clean(best.meta.Artist?.value || "Unknown creator"),
    license: best.license,
    licenseUrl: clean(best.meta.LicenseUrl?.value || ""),
    attribution: clean(best.meta.AttributionRequired?.value || ""),
    provider: "Wikimedia Commons photo",
    relevance: best.score
  };
}
async function findOpenverseImage(query) {
  const q = String(query || "").trim();
  if (!q) return null;
  const endpoint = "https://api.openverse.org/v1/images/?q=" + encodeURIComponent(q) +
    "&license=cc0,pdm,by,by-sa&aspect_ratio=wide&page_size=30";
  const response = await fetchWithTimeout(endpoint, {
    headers: { "User-Agent": "HiddenEngineDocumentaryBot/1.0 (licensed visual discovery)" }
  });
  if (!response.ok) throw new Error("Openverse image search failed ("+response.status+").");
  const data = await response.json();
  const candidates = (data.results || []).filter(item =>
    item.url && item.license && /^(cc0|pdm|by|by-sa)$/i.test(item.license) &&
    !USED_ASSET_PAGES.has(item.foreign_landing_url || item.detail_url)
  ).map(item => ({item,score:relevanceScore(q,[item.title,item.tags?.map(tag=>tag.name).join(" "),item.description].join(" "))}))
    .filter(candidate => candidate.score >= 0.5);
  candidates.sort((a,b)=>b.score-a.score);
  const best = candidates[0];
  if (!best) {
    console.log("Openverse returned no sufficiently relevant licensed image for: " + q);
    return null;
  }
  const item=best.item;
  return {
    url: item.thumbnail || item.url,
    page: item.foreign_landing_url || item.detail_url || item.url,
    creator: item.creator || "Unknown creator",
    provider: "Openverse photo",
    license: String(item.license).toUpperCase(),
    licenseUrl: item.license_url || "",
    creatorUrl: item.creator_url || "",
    relevance: best.score
  };
}
async function findPexelsVideo(query) {
  // Pexels footage is illustrative only; never label it as evidence of a specific company or event.
  if (!PEXELS_API_KEY) return null;
  const searchQuery = String(query || "").trim();
  if (!searchQuery) return null;
  const endpoint = "https://api.pexels.com/videos/search?query=" + encodeURIComponent(searchQuery) + "&orientation=landscape&per_page=8";
  const response = await fetchWithTimeout(endpoint, {
    headers: { Authorization: PEXELS_API_KEY }
  });
  if (!response.ok) throw new Error("Pexels search failed (" + response.status + "): " + (await response.text()).slice(0, 500));
  const data = await response.json();
  const videos = (data.videos || []).filter(video =>
    video.url && !USED_ASSET_PAGES.has(video.url) && video.video_files?.some(file => file.link && /mp4/i.test(file.file_type || ""))
  );
  videos.sort((a,b) => (b.width*b.height) - (a.width*a.height));
  for (const video of videos) {
    const files = video.video_files.filter(file => file.link && /mp4/i.test(file.file_type || ""));
    files.sort((a,b) => (b.width*b.height) - (a.width*a.height));
    const file = files.find(item => item.width >= 1280) || files[0];
    if (!file) continue;
    return {
      url: file.link, page: video.url, creator: video.user?.name || "Unknown creator",
      creatorUrl: video.user?.url || "", duration: video.duration, provider: "Pexels video"
    };
  }
  return null;
}

async function findNasaMedia(query, mediaType) {
  const q=String(query||"").trim(); if(!q) return null;
  const response=await fetchWithTimeout("https://images-api.nasa.gov/search?q="+encodeURIComponent(q)+"&media_type="+mediaType+"&page_size=30",{},20000);
  if(!response.ok) throw new Error("NASA media search failed ("+response.status+").");
  const data=await response.json();
  const candidates=(data.collection?.items||[]).map(item=>{
    const meta=item.data?.[0]||{};
    return {item,meta,id:meta.nasa_id,score:relevanceScore(q,[meta.title,meta.description,(meta.keywords||[]).join(" ")].join(" "))};
  }).filter(x=>x.id && x.score>=0.5 && !USED_ASSET_PAGES.has("NASA:"+x.id));
  candidates.sort((a,b)=>b.score-a.score);
  for(const candidate of candidates) {
    const {item,meta,id,score}=candidate;
    if(mediaType==="video") {
      const mr=await fetchWithTimeout("https://images-api.nasa.gov/asset/"+encodeURIComponent(id),{},20000);
      if(!mr.ok) continue;
      const manifest=await mr.json();
      const entries=Array.isArray(manifest)?manifest:(manifest.collection?.items||[]);
      const media=entries.find(x=>typeof x==="string" && /\.mp4(?:$|\?)/i.test(x)) ||
        entries.find(x=>typeof x?.href==="string" && /\.mp4(?:$|\?)/i.test(x.href))?.href;
      if(!media) continue;
      return {url:media,page:"https://images.nasa.gov/details/"+encodeURIComponent(id),creator:meta.center||"NASA",creatorUrl:"https://images.nasa.gov/",provider:"NASA video",license:"NASA media usage guidelines",licenseUrl:"https://www.nasa.gov/nasa-brand-center/images-and-media/",nasaId:id,relevance:score};
    }
    const preview=item.links?.find(x=>x.rel==="preview"&&x.href)?.href;
    if(!preview || !/\.(jpg|jpeg|png|webp)(?:$|\?)/i.test(preview)) continue;
    return {url:preview,page:"https://images.nasa.gov/details/"+encodeURIComponent(id),creator:meta.center||"NASA",creatorUrl:"https://images.nasa.gov/",provider:"NASA photo",license:"NASA media usage guidelines",licenseUrl:"https://www.nasa.gov/nasa-brand-center/images-and-media/",nasaId:id,relevance:score};
  }
  console.log("NASA "+mediaType+" search returned no sufficiently relevant unused media for: "+q);
  return null;
}

async function download(url, dest) {
  const response = await fetchWithTimeout(url, {}, 20000);
  if (!response.ok) throw new Error("Asset download failed (" + response.status + ").");
  await writeFile(dest, Buffer.from(await response.arrayBuffer()));
}
async function piperTTS(text, output) {
  if (!Number.isFinite(PIPER_LENGTH_SCALE) || PIPER_LENGTH_SCALE <= 0) throw new Error("PIPER_LENGTH_SCALE must be a positive number.");
  await access(PIPER_MODEL).catch(() => { throw new Error("Piper voice model not found: " + PIPER_MODEL); });
  await access(PIPER_MODEL + ".json").catch(() => { throw new Error("Piper voice config not found: " + PIPER_MODEL + ".json"); });
  await new Promise((resolve, reject) => {
    const child = spawn(PIPER_EXECUTABLE, ["--model", PIPER_MODEL, "--output_file", output, "--length_scale", String(PIPER_LENGTH_SCALE)], { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", chunk => stderr += chunk);
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error("Piper TTS exited with code " + code + ": " + stderr.slice(-1200))));
    child.stdin.on("error", reject);
    child.stdin.end(String(text));
  });
  const probe = await capture("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", output]);
  const duration = Number(probe.stdout.trim());
  if (!(duration > 0)) throw new Error("Piper produced an empty narration file.");
  return duration;
}

async function main() {
  const script = JSON.parse(await readFile(path.join(ROOT, "script.json"), "utf8"));
  if (!Array.isArray(script.scenes) || !script.scenes.length) throw new Error("script.json has no scenes.");
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const clips = [], credits = [], narrationDurations = [];
  for (let i=0; i<script.scenes.length; i++) {
    const scene = script.scenes[i];
    try { scene.visual = await selectSceneVisualWithGemini(scene, i + 1); }
    catch (error) { console.warn("Gemini visual planning failed for scene " + (i + 1) + "; retaining supplied visual only: " + error.message); }
    const stem = "scene-" + String(i+1).padStart(2,"0");
    const svg = path.join(OUT, stem + ".svg");
    const titleSvg = path.join(OUT, stem + "-title.svg");
    const clip = path.join(OUT, stem + "-visual.mp4");
    const audio = path.join(OUT, stem + ".wav");
    const rendered = path.join(OUT, stem + ".mp4");
    if (!scene.narration?.trim()) throw new Error("Scene " + (i+1) + " has no narration.");
    narrationDurations.push(await piperTTS(scene.narration, audio));
    await writeFile(svg, overlaySvg(scene, i, script.scenes.length));
    await writeFile(titleSvg, titleOverlaySvg(scene));
    //const query = scene.visual_query || [scene.title, scene.subtitle].filter(Boolean).join(" ");
    const shotQueries = Array.isArray(scene.visual_queries) ? scene.visual_queries.map(x => String(x).trim()).filter(Boolean) : [];
const query = shotQueries[0] || scene.visual_query || [scene.title, scene.subtitle].filter(Boolean).join(" ");
    console.log("Pexels key configured: " + Boolean(PEXELS_API_KEY));
    console.log("Searching visual asset for scene " + (i+1) + ": " + query);
    let asset = null;
    let still = null;
    const tryProvider = async (name, search) => {
      try { return await search(); }
      catch (error) {
        console.warn(name + " unavailable for scene " + (i+1) + "; continuing: " + error.message);
        return null;
      }
    };
    const words = String(query).toLowerCase().match(/[a-z0-9]{3,}/g) || [];
const variants = [...new Set([query, words.slice(0,3).join(" "), words.slice(0,2).join(" "), words.slice(0,1).join(" ")])].filter(Boolean);
for (const q of variants) {
  asset = await tryProvider("Pixabay video", () => findPixabayVideo(q));
  if (asset) break;
}
if (!asset) asset = await tryProvider("NASA video", () => findNasaMedia(query, "video"));
if (!asset) {
      if (!GEMINI_API_KEY) {
        console.warn("GEMINI_API_KEY is not configured; refusing unverified stock photos and using original motion graphics.");
      } else {
        for (const q of variants) {
          const candidates = await tryProvider("Pixabay image candidates", () => findPixabayImageCandidates(q, 8));
          if (!candidates || !candidates.length) continue;
          still = await tryProvider("Gemini visual relevance selection", () => selectImageWithGemini(scene.narration, scene.title, scene.subtitle, q, candidates));
          if (still) break;
        }
      }
    }
    if (asset) {
      USED_ASSET_PAGES.add(asset.nasaId ? "NASA:"+asset.nasaId : asset.page);

      const shotCount = Math.min(4, Math.max(1, Math.round(narrationDurations[i] / SCENE_DURATION_SECONDS)));
const shots = [path.join(OUT, stem + "-shot-0.mp4")];
await download(asset.url, shots[0]);
for (let s = 1; s < shotCount; s++) {
  let extra = null;
  //for (const q of variants) {
  for (const q of [shotQueries[s], ...variants].filter(Boolean)) {
    extra = await tryProvider("Pixabay video", () => findPixabayVideo(q));
    if (extra) break;
  }
  if (!extra) break;
  USED_ASSET_PAGES.add(extra.page);
  const extraClip = path.join(OUT, stem + "-shot-" + s + ".mp4");
  await download(extra.url, extraClip);
  shots.push(extraClip);
  credits.push({ scene:i+1, query, provider:extra.provider, page:extra.page, creator:extra.creator, creatorUrl:extra.creatorUrl, usage:"Illustrative footage; not proof of a named event or entity." });
}
const segment = (narrationDurations[i] / shots.length).toFixed(3);
const normalized = [];
for (let s = 0; s < shots.length; s++) {
  const normPath = path.join(OUT, stem + "-norm-" + s + ".mp4");
  await run("ffmpeg", ["-y","-stream_loop","-1","-i",shots[s],"-t",segment,"-an","-vf","scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=25,format=yuv420p","-c:v","libx264","-preset","veryfast","-crf","21",normPath]);
  normalized.push(normPath);
}
const shotList = path.join(OUT, stem + "-shots.txt");
await writeFile(shotList, normalized.map(f => "file '" + path.basename(f) + "'").join("\n") + "\n");
await run("ffmpeg", ["-y","-f","concat","-safe","0","-i",shotList,"-c","copy",clip]);
      credits.push({ scene:i+1, query, provider:asset.provider || "Pexels video", page:asset.page, creator:asset.creator, creatorUrl:asset.creatorUrl, usage:"Illustrative footage; not proof of a named event or entity." });
      await run("ffmpeg", ["-y","-stream_loop","-1","-i",clip,"-loop","1","-i",svg,"-loop","1","-i",titleSvg,"-i",audio,
        "-filter_complex","[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,eq=contrast=1.12:saturation=0.78,drawbox=x=0:y=0:w=iw:h=ih:color=#08090b@0.18:t=fill[bg];[bg][1:v]overlay=0:0[base];[2:v]format=rgba,fade=t=in:st=0:d=0.7:alpha=1,fade=t=out:st=3.6:d=0.65:alpha=1[title];[base][title]overlay=x='120-90*max(0,1-t/0.7)+90*max(0,min(1,(t-3.6)/0.65))':y=0:format=auto,format=yuv420p[v]",
        "-map","[v]","-map","3:a","-c:v","libx264","-preset","veryfast","-crf","21","-c:a","aac","-b:a","192k","-shortest","-t",String(narrationDurations[i]),"-movflags","+faststart",rendered]);
    } else if (still) {
      USED_ASSET_PAGES.add(still.nasaId ? "NASA:"+still.nasaId : still.page);
      const imagePath=clip.replace(/\.mp4$/,".jpg");
      await download(still.url, imagePath);
      credits.push({ scene:i+1, query, provider:still.provider || (still.license ? "Wikimedia Commons photo" : "Pexels photo"), page:still.page, creator:still.creator, creatorUrl:still.creatorUrl || "", license:still.license || (still.provider === "Pixabay photo" ? "Pixabay Content License" : still.provider === "Pexels photo" ? "Pexels License" : "See source page"), licenseUrl:still.licenseUrl || "", usage:"Illustrative still; not proof of a named event or entity." });
      await run("ffmpeg", ["-y","-loop","1","-framerate","25","-i",imagePath,"-loop","1","-i",svg,"-loop","1","-i",titleSvg,"-i",audio,
        "-filter_complex","[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,zoompan=z='min(zoom+0.0003,1.07)':d=1:s=1920x1080:fps=25,eq=contrast=1.08:saturation=0.82[bg];[bg][1:v]overlay=0:0[base];[2:v]format=rgba,fade=t=in:st=0:d=0.7:alpha=1,fade=t=out:st=3.6:d=0.65:alpha=1[title];[base][title]overlay=x='120-90*max(0,1-t/0.7)+90*max(0,min(1,(t-3.6)/0.65))':y=0:format=auto,format=yuv420p[v]",
        "-map","[v]","-map","3:a","-c:v","libx264","-preset","veryfast","-crf","21","-c:a","aac","-b:a","192k","-shortest","-t",String(narrationDurations[i]),"-movflags","+faststart",rendered]);
    } else {
      credits.push({ scene:i+1, query, provider:"Original motion graphic", note:"No matching licensed stock asset was returned; generated a branded motion graphic instead." });
      await run("ffmpeg", ["-y","-f","lavfi","-i","color=c=#101113:s=1920x1080:r=25:d=3600","-loop","1","-i",svg,"-loop","1","-i",titleSvg,"-i",audio,
        "-filter_complex","[0:v]format=yuv420p[bg];[bg][1:v]overlay=0:0[base];[2:v]format=rgba,fade=t=in:st=0:d=0.7:alpha=1,fade=t=out:st=3.6:d=0.65:alpha=1[title];[base][title]overlay=x='120-90*max(0,1-t/0.7)+90*max(0,min(1,(t-3.6)/0.65))':y=0:format=auto,format=yuv420p[v]",
        "-map","[v]","-map","3:a","-c:v","libx264","-preset","veryfast","-crf","21","-c:a","aac","-b:a","192k","-shortest","-t",String(narrationDurations[i]),"-movflags","+faststart",rendered]);
    }
    clips.push(rendered);
    console.log("Rendered narrated scene " + (i+1) + "/" + script.scenes.length + ".");
  }
  const stockScenes = credits.filter(item => ["Pixabay video","Pixabay photo","Pexels video","Pexels photo","Wikimedia Commons photo","Openverse photo","NASA video","NASA photo"].includes(item.provider)).length;
  console.log("Visual assets: " + stockScenes + "/" + script.scenes.length + " scenes use licensed photo/video; remaining scenes use original motion graphics.");
  const list = path.join(OUT,"concat.txt");
  await writeFile(list, clips.map(f=>"file '"+path.basename(f)+"'").join("\n")+"\n");
  const output = path.join(OUT,"the-hidden-engine-documentary.mp4");
  await run("ffmpeg",["-y","-fflags","+genpts","-f","concat","-safe","0","-i",list,"-vf","setpts=PTS-STARTPTS,fps=25","-af","aresample=48000:async=1:first_pts=0,asetpts=N/SR/TB","-t",String(narrationDurations.reduce((sum,duration)=>sum+duration,0)),"-shortest","-c:v","libx264","-preset","veryfast","-crf","21","-r","25","-pix_fmt","yuv420p","-c:a","aac","-b:a","192k","-ar","48000","-movflags","+faststart",output]);
  await writeFile(path.join(OUT,"visual-credits.json"),JSON.stringify(credits,null,2)+"\n");
  await writeFile(path.join(OUT,"CREDITS.md"),[
    "# Visual credits","",
    "Stock photos/videos are sourced from Pixabay, Pexels, Wikimedia Commons, Openverse, or NASA. Review each linked asset page and its applicable usage guidance before publication.",
    "All stock footage is illustrative material and must not be presented as actual footage of a specific company, person, product, or event unless independently verified.",
    "",
    ...credits.map(c=>c.page
      ? "- Scene "+c.scene+": ["+c.provider+"]("+c.page+") — "+c.creator+" — "+(c.license||"Pexels License")+(c.licenseUrl?" ("+c.licenseUrl+")":"")
      : "- Scene "+c.scene+": "+c.provider+" — "+c.note)
  ].join("\n")+"\n");
  await writeFile(path.join(OUT,"README.txt"),[
    "The Hidden Engine visual-only documentary render",
    "Audio: Piper TTS narration (configurable voice model and speaking rate); no music.",
    "Visuals: relevance-filtered Pixabay video and photos, NASA media, Wikimedia Commons/Openverse images; otherwise original branded motion graphics.",
    "Narration: generated locally by Piper TTS. No music; only narration audio.",
    "Identity: charcoal/black, ivory typography, restrained copper accents, documentary-investigative overlays.",
    "Review visual relevance, licenses, and credits before publication.",
    "No automatic YouTube upload."
  ].join("\n")+"\n");
  const qa = await new Promise((resolve,reject) => { const p=spawn("ffprobe",["-v","error","-show_entries","format=duration:stream=codec_type,width,height","-of","json",output]); let data=""; p.stdout.on("data",d=>data+=d); p.on("error",reject); p.on("close",code=>code===0?resolve(JSON.parse(data)):reject(new Error("ffprobe failed"))); });
  if (!qa.streams.some(x=>x.codec_type==="video" && x.width===1920 && x.height===1080) || !qa.streams.some(x=>x.codec_type==="audio")) throw new Error("Final MP4 failed 1080p video/audio QA.");
  const finalDuration = Number(qa.format.duration);
  const expectedNarrationDuration = narrationDurations.reduce((sum, duration) => sum + duration, 0);
  const averageSceneDuration = finalDuration / clips.length;
  const durationTolerance = Math.max(3, clips.length * 0.5);
  if (clips.length < 5 || Math.abs(finalDuration - expectedNarrationDuration) > durationTolerance) throw new Error("Final pacing QA failed: " + clips.length + " scenes; rendered " + finalDuration.toFixed(2) + "s vs narration " + expectedNarrationDuration.toFixed(2) + "s.");
  await writeFile(path.join(OUT,"QA-REPORT.json"),JSON.stringify({file:path.basename(output),width:1920,height:1080,duration:Number(qa.format.duration),audio:true,audioDesign:"Piper TTS narration; no music",scenes:clips.length,averageSceneDuration,visualProviders:[...new Set(credits.map(c=>c.provider))],semanticImageSelector:GEMINI_API_KEY?"Gemini multimodal":"disabled",semanticImageScenes:credits.filter(c=>c.semanticConfidence>=85).length,geminiPlannedGraphics:script.scenes.filter(s=>s.visual&&s.visual.type).length,geminiGraphicTypes:[...new Set(script.scenes.filter(s=>s.visual&&s.visual.type).map(s=>s.visual.type))],licensedAssetScenes:stockScenes},null,2)+"\n");
  console.log("Rendered and passed 1080p video/audio pacing QA: "+output);
}
main().catch(error=>{console.error("Render failed:",error);process.exit(1);});
