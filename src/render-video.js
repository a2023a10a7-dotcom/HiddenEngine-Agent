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
  if (!title && !subtitle) return '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"></svg>';
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

function splitNarrationIntoShots(narration, maxWords = 16) {
  const sentences = String(narration || "").match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  const units = [];
  for (const sentence of sentences) {
    const words = sentence.trim().split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i += maxWords) units.push(words.slice(i, i + maxWords).join(" "));
  }
  const shots = [];
  let current = [];
  for (const unit of units) {
    const words = unit.split(/\s+/).length;
    if (current.length && current.join(" ").split(/\s+/).length + words > maxWords) {
      shots.push(current.join(" ")); current = [];
    }
    current.push(unit);
  }
  if (current.length) shots.push(current.join(" "));
  return shots.filter(Boolean);
}

async function main() {
  const script = JSON.parse(await readFile(path.join(ROOT, "script.json"), "utf8"));
  if (!Array.isArray(script.scenes) || !script.scenes.length) throw new Error("script.json has no scenes.");
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const clips = [], credits = [], narrationDurations = [], shotReport = [];
  let totalShots = 0;

  for (let i = 0; i < script.scenes.length; i++) {
    const scene = script.scenes[i];
    if (!scene.narration?.trim()) throw new Error("Scene " + (i + 1) + " has no narration.");
    const shotTexts = splitNarrationIntoShots(scene.narration, 16);
    if (!shotTexts.length) throw new Error("Scene " + (i + 1) + " produced no visual shots.");
    console.log("Scene " + (i + 1) + ": splitting narration into " + shotTexts.length + " shots.");

    for (let j = 0; j < shotTexts.length; j++) {
      totalShots++;
      const shotText = shotTexts[j];
      const stem = "scene-" + String(i + 1).padStart(2, "0") + "-shot-" + String(j + 1).padStart(2, "0");
      const svg = path.join(OUT, stem + ".svg");
      const titleSvg = path.join(OUT, stem + "-title.svg");
      const visualFile = path.join(OUT, stem + "-visual.mp4");
      const audio = path.join(OUT, stem + ".wav");
      const rendered = path.join(OUT, stem + ".mp4");
      const shotScene = { ...scene, visual: j === 0 ? scene.visual : null };
      const titleScene = j === 0 ? scene : { title: "", subtitle: "" };
      const narrationDuration = await piperTTS(shotText, audio);
      narrationDurations.push(narrationDuration);
      await writeFile(svg, overlaySvg(shotScene, i, script.scenes.length));
      await writeFile(titleSvg, titleOverlaySvg(titleScene));

      const queryParts = [scene.visual_query, scene.title, shotText].filter(Boolean);
      const query = queryParts.join(" ").slice(0, 240);
      console.log("Searching unique visual for " + stem + ": " + query);
      let asset = null;
      let still = null;
      const tryProvider = async (name, search) => {
        try { return await search(); }
        catch (error) {
          console.warn(name + " unavailable for " + stem + "; continuing: " + error.message);
          return null;
        }
      };
      asset = await tryProvider("Pixabay video", () => findPixabayVideo(query));
      if (!asset) asset = await tryProvider("Pexels video", () => findPexelsVideo(query));
      if (!asset) asset = await tryProvider("NASA video", () => findNasaMedia(query, "video"));
      if (!asset) still = await tryProvider("Pixabay photo", () => findPixabayImage(query));
      if (!asset && !still) still = await tryProvider("Wikimedia Commons", () => findCommonsImage(query));
      if (!asset && !still) still = await tryProvider("Openverse", () => findOpenverseImage(query));
      if (!asset && !still) still = await tryProvider("NASA photo", () => findNasaMedia(query, "image"));

      let visualInput;
      let filter;
      let audioInputIndex;
      if (asset) {
        USED_ASSET_PAGES.add(asset.nasaId ? "NASA:" + asset.nasaId : asset.page);
        await download(asset.url, visualFile);
        credits.push({
          scene: i + 1, shot: j + 1, narration: shotText, query,
          provider: asset.provider || "Pixabay video", page: asset.page,
          creator: asset.creator, creatorUrl: asset.creatorUrl,
          usage: "Illustrative footage; not proof of a named event or entity."
        });
        visualInput = ["-stream_loop", "-1", "-i", visualFile];
        filter = "[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,eq=contrast=1.12:saturation=0.78,drawbox=x=0:y=0:w=iw:h=ih:color=#08090b@0.18:t=fill[bg]";
      } else if (still) {
        USED_ASSET_PAGES.add(still.nasaId ? "NASA:" + still.nasaId : still.page);
        const imagePath = visualFile.replace(/\.mp4$/, ".jpg");
        await download(still.url, imagePath);
        credits.push({
          scene: i + 1, shot: j + 1, narration: shotText, query,
          provider: still.provider || "Licensed photo", page: still.page,
          creator: still.creator, creatorUrl: still.creatorUrl || "",
          license: still.license || "See source page", licenseUrl: still.licenseUrl || "",
          usage: "Illustrative still; not proof of a named event or entity."
        });
        visualInput = ["-loop", "1", "-framerate", "25", "-i", imagePath];
        filter = "[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,zoompan=z='min(zoom+0.0003,1.07)':d=1:s=1920x1080:fps=25,eq=contrast=1.08:saturation=0.82[bg]";
      } else {
        credits.push({
          scene: i + 1, shot: j + 1, narration: shotText, query,
          provider: "Original motion graphic",
          note: "No sufficiently relevant unused licensed asset was found for this shot."
        });
        visualInput = ["-f", "lavfi", "-i", "color=c=#101113:s=1920x1080:r=25:d=3600"];
        filter = "[0:v]format=yuv420p[bg]";
      }

      const hasTitle = j === 0 && Boolean(scene.title || scene.subtitle);
      const args = ["-y", ...visualInput, "-loop", "1", "-i", svg];
      if (hasTitle) args.push("-loop", "1", "-i", titleSvg);
      args.push("-i", audio);
      const overlayIndex = 1;
      if (hasTitle) {
        filter += ";[bg][" + overlayIndex + ":v]overlay=0:0[base];[" + (overlayIndex + 1) + ":v]format=rgba,fade=t=in:st=0:d=0.7:alpha=1,fade=t=out:st=3.6:d=0.65:alpha=1[title];[base][title]overlay=x='120-90*max(0,1-t/0.7)+90*max(0,min(1,(t-3.6)/0.65))':y=0:format=auto,tpad=stop_mode=clone:stop_duration=" + narrationDuration + ",trim=duration=" + narrationDuration + ",setpts=PTS-STARTPTS[v]";
        audioInputIndex = 3;
      } else {
        filter += ";[bg][" + overlayIndex + ":v]overlay=0:0,tpad=stop_mode=clone:stop_duration=" + narrationDuration + ",trim=duration=" + narrationDuration + ",setpts=PTS-STARTPTS,format=yuv420p[v]";
        audioInputIndex = 2;
      }
      args.push(
        "-filter_complex", filter,
        "-map", "[v]", "-map", audioInputIndex + ":a",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
        "-c:a", "aac", "-b:a", "192k",
        "-t", String(narrationDuration), "-movflags", "+faststart", rendered
      );
      await run("ffmpeg", args);
      const clipProbe = await capture("ffprobe", [
        "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", rendered
      ]);
      const actualClipDuration = Number(clipProbe.stdout.trim());
      if (!Number.isFinite(actualClipDuration) || Math.abs(actualClipDuration - narrationDuration) > 0.35) {
        throw new Error("Shot duration mismatch for " + stem + ": rendered " +
          actualClipDuration.toFixed(2) + "s vs narration " + narrationDuration.toFixed(2) + "s.");
      }
      clips.push(rendered);
      shotReport.push({
        scene: i + 1, shot: j + 1, words: shotText.trim().split(/\s+/).length,
        narrationDuration: Number(narrationDuration.toFixed(3)),
        visualType: asset ? "video" : still ? "image" : "motion-graphic",
        provider: asset?.provider || still?.provider || "Original motion graphic"
      });
      console.log("Rendered " + stem + " (" + narrationDuration.toFixed(1) + "s).");
    }
  }

  const stockShots = credits.filter(item => [
    "Pixabay video", "Pixabay photo", "Pexels video", "Pexels photo",
    "Wikimedia Commons photo", "Openverse photo", "NASA video", "NASA photo"
  ].includes(item.provider)).length;
  console.log("Visual assets: " + stockShots + "/" + totalShots + " shots use distinct licensed photo/video; other shots use original motion graphics.");
  const output = path.join(OUT, "the-hidden-engine-documentary.mp4");
  const concatInputs = [];
  const concatFilters = [];
  for (let index = 0; index < clips.length; index++) {
    concatInputs.push("-i", clips[index]);
    concatFilters.push(
      "[" + index + ":v:0]setpts=PTS-STARTPTS,fps=25,format=yuv420p[v" + index + "];" +
      "[" + index + ":a:0]aresample=48000,asetpts=PTS-STARTPTS[a" + index + "]"
    );
  }
  const concatLabels = clips.map((_, index) => "[v" + index + "][a" + index + "]").join("");
  const concatFilter = concatFilters.join(";") + ";" + concatLabels +
    "concat=n=" + clips.length + ":v=1:a=1[v][a]";
  await run("ffmpeg", [
    "-y", ...concatInputs,
    "-filter_complex", concatFilter,
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
    "-r", "25", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
    "-ar", "48000", "-movflags", "+faststart", output
  ]);
  await writeFile(path.join(OUT, "visual-credits.json"), JSON.stringify(credits, null, 2) + "\n");
  await writeFile(path.join(OUT, "shot-breakdown.json"), JSON.stringify(shotReport, null, 2) + "\n");
  await writeFile(path.join(OUT, "CREDITS.md"), [
    "# Visual credits", "",
    "Stock photos/videos are sourced from Pixabay, Pexels, Wikimedia Commons, Openverse, or NASA. Review each linked asset page and its applicable usage guidance before publication.",
    "All stock footage is illustrative material and must not be presented as actual footage of a specific company, person, product, or event unless independently verified.",
    "",
    ...credits.map(c => c.page
      ? "- Scene " + c.scene + ", shot " + c.shot + ": [" + c.provider + "](" + c.page + ") — " + c.creator + " — " + (c.license || "See source page") + (c.licenseUrl ? " (" + c.licenseUrl + ")" : "")
      : "- Scene " + c.scene + ", shot " + c.shot + ": " + c.provider + " — " + c.note)
  ].join("\n") + "\n");
  await writeFile(path.join(OUT, "README.txt"), [
    "The Hidden Engine multi-shot documentary render",
    "Audio: Piper TTS narration regenerated per short visual beat; no music.",
    "Visuals: a new relevance-filtered asset is searched for each narration beat, with no adjacent asset reuse; otherwise an original branded motion graphic is used.",
    "Identity: charcoal/black, ivory typography, restrained copper accents, documentary-investigative overlays.",
    "Review visual relevance, licenses, and credits before publication.",
    "No automatic YouTube upload."
  ].join("\n") + "\n");

  const qa = await new Promise((resolve, reject) => {
    const probe = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", output]);
    let data = "";
    probe.stdout.on("data", chunk => data += chunk);
    probe.on("error", reject);
    probe.on("close", code => code === 0 ? resolve(JSON.parse(data)) : reject(new Error("ffprobe failed")));
  });
  if (!qa.streams.some(stream => stream.codec_type === "video" && stream.width === 1920 && stream.height === 1080) ||
      !qa.streams.some(stream => stream.codec_type === "audio")) {
    throw new Error("Final MP4 failed 1080p video/audio QA.");
  }
  const finalDuration = Number(qa.format.duration);
  const expectedDuration = narrationDurations.reduce((sum, duration) => sum + duration, 0);
  const averageShotDuration = finalDuration / totalShots;
  const durationTolerance = Math.max(3, totalShots * 0.5);
  const longestShot = Math.max(...narrationDurations);
  if (totalShots < script.scenes.length || averageShotDuration > 9.5 || longestShot > 13 ||
      Math.abs(finalDuration - expectedDuration) > durationTolerance) {
    throw new Error("Multi-shot pacing QA failed: " + totalShots + " shots, average " +
      averageShotDuration.toFixed(2) + "s, longest " + longestShot.toFixed(2) +
      "s; rendered " + finalDuration.toFixed(2) + "s vs narration " + expectedDuration.toFixed(2) + "s.");
  }
  await writeFile(path.join(OUT, "QA-REPORT.json"), JSON.stringify({
    file: path.basename(output), width: 1920, height: 1080,
    duration: finalDuration, audio: true, audioDesign: "Piper TTS narration; no music",
    scenes: script.scenes.length, shots: totalShots,
    averageShotDuration, longestShotDuration: longestShot,
    visualProviders: [...new Set(credits.map(item => item.provider))],
    licensedAssetShots: stockShots, shotBreakdown: shotReport
  }, null, 2) + "\n");
  console.log("Rendered and passed multi-shot 1080p video/audio pacing QA: " + output);
}
main().catch(error=>{console.error("Render failed:",error);process.exit(1);});
