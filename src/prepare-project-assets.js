// Multi-provider, scene-matched visual acquisition for The Hidden Engine.
// Providers: Wikimedia Commons, Internet Archive, Pollinations, Unsplash, and Pixabay.
// Every acquired file keeps source, creator, license evidence, and attribution metadata.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const projectId = process.env.PROJECT_ID;
if (!projectId || !/^[a-z0-9-]+$/.test(projectId)) throw new Error("PROJECT_ID missing or invalid.");
const root = path.join("production", "projects", projectId);
const out = path.join("dist", projectId);
const keys = {
  pollinations: process.env.POLLINATIONS_API_KEY,
  unsplash: process.env.UNSPLASH_ACCESS_KEY,
  pixabay: process.env.PIXABAY_API_KEY
};
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_BYTES = 160 * 1024 * 1024;
const MIN_WIDTH = 1280, MIN_HEIGHT = 720;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const stop = new Set(["the","and","for","with","from","that","this","into","over","under","about","after","before","when","where","what","which","while","will","would","could","should","have","has","had","were","was","are","is","been","being","its","our","your","company","companies","business","story","scene","chapter","technology","modern"]);
const terms = value => String(value || "").toLowerCase().split(/[^a-z0-9]+/).filter(x => x.length > 2 && !stop.has(x));
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;" }[c]));
const safeHttps = value => {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password ? u.toString() : null;
  } catch { return null; }
};
async function fetchJson(url, options = {}, label = "provider") {
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(45000) });
      if (response.ok) return await response.json();
      const detail = (await response.text()).slice(0, 240);
      if (response.status !== 429 && response.status < 500) throw new Error(label + " HTTP " + response.status + ": " + detail);
      last = new Error(label + " HTTP " + response.status + ": " + detail);
      await sleep(Math.min(20000, 1500 * (2 ** attempt)));
    } catch (error) {
      last = error;
      if (attempt === 3) break;
      await sleep(Math.min(12000, 1000 * (2 ** attempt)));
    }
  }
  throw new Error(label + " request failed: " + (last?.message || "unknown error"));
}
async function download(url, file, maxBytes = MAX_IMAGE_BYTES, headers = {}) {
  const safe = safeHttps(url);
  if (!safe) throw new Error("Rejected non-HTTPS media URL.");
  const response = await fetch(safe, { headers, redirect: "follow", signal: AbortSignal.timeout(90000) });
  if (!response.ok) throw new Error("Media download HTTP " + response.status);
  const finalUrl = safeHttps(response.url);
  if (!finalUrl) throw new Error("Rejected unsafe media redirect.");
  const type = (response.headers.get("content-type") || "").toLowerCase();
  if (type.includes("text/html") || type.includes("application/json")) throw new Error("Provider returned a page instead of media.");
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error("Media exceeds size limit.");
  if (!response.body) throw new Error("Media response has no readable body.");
  const reader = response.body.getReader(), chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("Media exceeds configured size limit.");
        throw new Error("Media exceeds size limit.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  if (total < 4096) throw new Error("Downloaded media size is invalid (" + total + " bytes).");
  const bytes = Buffer.concat(chunks, total);
  await writeFile(file, bytes);
  return { bytes: total, url: finalUrl, contentType: type };
}
function scoreTags(query, tags) {
  const hay = String(tags || "").toLowerCase();
  return terms(query).reduce((n, token) => n + (hay.includes(token) ? (token.length > 5 ? 3 : 1) : 0), 0);
}
function sceneQueries(scene) {
  const raw = [
    scene.title, scene.subtitle, ...(scene.keywords || []), ...(scene.visual_queries || []),
    ...(Array.isArray(scene.visual_requirements) ? scene.visual_requirements.flat() : []),
    ...(scene.beats || []).slice(0, 6).flatMap(b => [
      b.on_screen_text || "", b.narration || "", ...(b.entities || []),
      b.visual?.subject || "", b.visual?.description || ""
    ])
  ].filter(Boolean).join(" ");
  const clean = raw.replace(/\s+/g, " ").trim();
  const base = clean.split(/[.!?]/)[0].slice(0, 150);
  const entity = terms(base).slice(0, 7).join(" ");
  const queries = [...(scene.visual_queries || []), base, entity].filter(q => q && q.length > 5);
  return [...new Set(queries)].slice(0, 3);
}
function licenseAllowed(value) {
  const s = String(value || "").toLowerCase();
  if (!s) return false;
  if (/\b(nc|non.?commercial|no.?derivatives|nd)\b/.test(s)) return false;
  return /public.?domain|cc0|creativecommons\.org\/(publicdomain|licenses\/by(?:-sa)?\/)|\b(cc by|cc by-sa)\b/.test(s);
}
function extValue(metadata, key) {
  const item = metadata?.[key];
  return String(item?.value || item?.url || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
const assets = [], selection = [], sheetItems = [], warnings = [];
const seen = new Set();
let assetCounter = 0;
function addAsset(data) {
  const id = "VIS-" + String(++assetCounter).padStart(4, "0");
  const asset = { id, ...data };
  assets.push(asset);
  if (asset.kind !== "video") sheetItems.push({ id, scene: asset.scene, tags: asset.tags || asset.title || asset.provider, mimeType: asset.mimeType || "image/jpeg", file: path.join(out, asset.previewFile) });
  return asset;
}
async function commonsSearch(query, sceneNo, max = 3) {
  const u = new URL("https://commons.wikimedia.org/w/api.php");
  for (const [k,v] of Object.entries({
    action:"query",format:"json",generator:"search",gsrsearch:"filetype:bitmap " + query,
    gsrnamespace:"6",gsrlimit:String(max * 3),prop:"imageinfo",iiprop:"url|extmetadata|size",
    iiurlwidth:"1600",origin:"*"
  })) u.searchParams.set(k,v);
  const data = await fetchJson(u, { headers: { "User-Agent":"TheHiddenEngine/1.0 (documentary media research; contact: github repository)" } }, "Wikimedia Commons");
  const pages = Object.values(data.query?.pages || {});
  const selected = [];
  for (const page of pages) {
    const info = page.imageinfo?.[0], meta = info?.extmetadata || {};
    const license = extValue(meta, "LicenseShortName") || extValue(meta, "UsageTerms");
    const licenseUrl = extValue(meta, "LicenseUrl");
    const sourcePage = safeHttps(info?.descriptionurl);
    const mediaUrl = safeHttps(info?.thumburl || info?.url);
    if (!sourcePage || !mediaUrl || !licenseAllowed(license + " " + licenseUrl)) continue;
    if ((info.width || 0) < MIN_WIDTH || (info.height || 0) < MIN_HEIGHT) continue;
    const key = "commons:" + page.pageid;
    if (seen.has(key)) continue;
    const file = path.join(out, "commons-" + page.pageid + ".jpg");
    try {
      const got = await download(mediaUrl, file);
      seen.add(key);
      selected.push(addAsset({
        scene:sceneNo,kind:"photo",provider:"Wikimedia Commons",title:page.title,
        creator:extValue(meta,"Artist") || extValue(meta,"Credit") || "Creator listed on source page",
        tags:page.title + " " + query,sourcePage,previewFile:path.basename(file),
        license,licenseUrl:licenseUrl || sourcePage,licenseEvidence:sourcePage,
        attributionRequired:true,attribution:extValue(meta,"AttributionRequired") || "Credit creator and license; verify source page",
        mediaUrl:got.url,mimeType:got.contentType || "image/jpeg",searchQuery:query,width:info.width,height:info.height,bytes:got.bytes
      }));
      if (selected.length >= max) break;
    } catch (e) { warnings.push("Wikimedia " + page.title + ": " + e.message); }
  }
  return selected;
}
async function internetArchiveSearch(query, sceneNo, max = 1) {
  const q = 'mediatype:movies AND (' + terms(query).slice(0,4).map(t => 'title:' + t).join(" OR ") + ')';
  const u = new URL("https://archive.org/advancedsearch.php");
  u.searchParams.set("q", q);
  for (const field of ["identifier","title","creator","licenseurl","year"]) u.searchParams.append("fl[]", field);
  u.searchParams.set("rows","12"); u.searchParams.set("output","json");
  const data = await fetchJson(u, {}, "Internet Archive search");
  const docs = data.response?.docs || [];
  const selected = [];
  for (const doc of docs) {
    if (!doc.identifier || seen.has("ia:" + doc.identifier)) continue;
    try {
      const meta = await fetchJson("https://archive.org/metadata/" + encodeURIComponent(doc.identifier), {}, "Internet Archive metadata");
      const metadata = meta.metadata || {};
      const license = String(metadata.licenseurl || doc.licenseurl || "");
      if (!licenseAllowed(license)) continue;
      const files = (meta.files || []).filter(f => {
        const format = String(f.format || "").toLowerCase();
        const name = String(f.name || "");
        const size = Number(f.size || 0);
        return /mpeg4|h\.264|h264|mp4/.test(format + " " + name.toLowerCase()) && size > 50000 && size <= MAX_VIDEO_BYTES;
      }).sort((a,b) => Number(a.size)-Number(b.size));
      const media = files[0];
      if (!media) continue;
      const sourcePage = "https://archive.org/details/" + encodeURIComponent(doc.identifier);
      const mediaUrl = "https://archive.org/download/" + encodeURIComponent(doc.identifier) + "/" + media.name.split("/").map(encodeURIComponent).join("/");
      const file = path.join(out, "ia-" + doc.identifier.replace(/[^a-z0-9_-]/gi,"-") + ".mp4");
      const got = await download(mediaUrl, file, MAX_VIDEO_BYTES);
      seen.add("ia:" + doc.identifier);
      selected.push(addAsset({
        scene:sceneNo,kind:"video",provider:"Internet Archive",title:metadata.title || doc.title || doc.identifier,
        creator:metadata.creator || doc.creator || "Creator listed by Internet Archive",tags:(metadata.subject || []).toString() + " " + query,
        sourcePage,previewFile:path.basename(file),license,licenseUrl:license,licenseEvidence:sourcePage,
        attributionRequired:true,attribution:"Verify item-level credit and license terms before publication",
        mediaUrl:got.url,searchQuery:query,width:0,height:0,durationSeconds:Number(media.duration)||null,bytes:got.bytes
      }));
      if (selected.length >= max) break;
    } catch (e) { warnings.push("Internet Archive " + doc.identifier + ": " + e.message); }
  }
  return selected;
}
async function pollinationsImage(query, sceneNo, index) {
  if (!keys.pollinations) { warnings.push("Pollinations skipped: POLLINATIONS_API_KEY is not configured."); return null; }
  const prompt = "Documentary editorial photograph, photorealistic, historically plausible, accurate subject: " + query + ". No text, no logos, no watermark, wide 16:9 composition.";
  const u = new URL("https://gen.pollinations.ai/image/" + encodeURIComponent(prompt));
  u.searchParams.set("width","1536"); u.searchParams.set("height","864"); u.searchParams.set("nologo","true");
  const file = path.join(out, "pollinations-scene-" + sceneNo + "-" + index + ".jpg");
  try {
    const got = await download(u.toString(), file, MAX_IMAGE_BYTES, { Authorization:"Bearer " + keys.pollinations });
    return addAsset({
      scene:sceneNo,kind:"photo",provider:"Pollinations",title:"AI-generated visual: " + query,
      creator:"Generated for The Hidden Engine using Pollinations",tags:query,sourcePage:u.toString(),
      previewFile:path.basename(file),license:"AI-generated; subject to Pollinations service terms",
      licenseUrl:"https://gen.pollinations.ai/docs",licenseEvidence:"https://gen.pollinations.ai/docs",
      attributionRequired:false,attribution:"AI-generated image; not documentary evidence",
      mediaUrl:got.url,mimeType:got.contentType || "image/jpeg",searchQuery:query,width:1536,height:864,bytes:got.bytes,illustrative:true
    });
  } catch (e) { warnings.push("Pollinations scene " + sceneNo + ": " + e.message); return null; }
}
async function unsplashSearch(query, sceneNo, max = 2) {
  if (!keys.unsplash) { warnings.push("Unsplash skipped: UNSPLASH_ACCESS_KEY is not configured."); return []; }
  const u = new URL("https://api.unsplash.com/search/photos");
  u.searchParams.set("query",query); u.searchParams.set("orientation","landscape"); u.searchParams.set("per_page","10"); u.searchParams.set("content_filter","high");
  const data = await fetchJson(u, { headers: { Authorization:"Client-ID " + keys.unsplash } }, "Unsplash");
  const selected = [];
  for (const photo of data.results || []) {
    if (!photo.id || seen.has("unsplash:" + photo.id) || (photo.width||0) < MIN_WIDTH || (photo.height||0) < MIN_HEIGHT) continue;
    const page = safeHttps(photo.links?.html), imageUrl = safeHttps(photo.urls?.regular), downloadLocation = safeHttps(photo.links?.download_location);
    if (!page || !imageUrl || !downloadLocation) continue;
    try {
      // Unsplash requires a download-location event when an API result is used as a downloaded asset.
      await fetchJson(downloadLocation, { headers: { Authorization:"Client-ID " + keys.unsplash } }, "Unsplash download tracking");
      const file = path.join(out,"unsplash-" + photo.id + ".jpg");
      const got = await download(imageUrl,file);
      seen.add("unsplash:" + photo.id);
      selected.push(addAsset({
        scene:sceneNo,kind:"photo",provider:"Unsplash",title:photo.alt_description || photo.description || query,
        creator:photo.user?.name || photo.user?.username || "Unsplash photographer",creatorUrl:photo.user?.links?.html ? photo.user.links.html.split("?")[0] + "?utm_source=the_hidden_engine&utm_medium=referral" : "https://unsplash.com/?utm_source=the_hidden_engine&utm_medium=referral",
        tags:(photo.alt_description||"") + " " + query,sourcePage:page,previewFile:path.basename(file),
        license:"Unsplash License",licenseUrl:"https://unsplash.com/license",licenseEvidence:"https://unsplash.com/documentation",
        attributionRequired:true,attribution:"Photo by " + (photo.user?.name || photo.user?.username || "Unsplash photographer") + " on Unsplash",
        mediaUrl:got.url,mimeType:got.contentType || "image/jpeg",searchQuery:query,width:photo.width,height:photo.height,bytes:got.bytes
      }));
      if (selected.length >= max) break;
    } catch(e) { warnings.push("Unsplash " + photo.id + ": " + e.message); }
  }
  return selected;
}
async function pixabaySearch(query, sceneNo, max = 3) {
  if (!keys.pixabay) { warnings.push("Pixabay skipped: PIXABAY_API_KEY is not configured."); return []; }
  const u = new URL("https://pixabay.com/api/");
  const safeQuery = String(query || "").replace(/\s+/g, " ").trim().slice(0, 100);
  if (!safeQuery) { warnings.push("Pixabay skipped: search query is empty."); return []; }
  u.searchParams.set("key",keys.pixabay);u.searchParams.set("q",safeQuery);u.searchParams.set("image_type","photo");
  u.searchParams.set("orientation","horizontal");u.searchParams.set("safesearch","true");u.searchParams.set("per_page","30");
  const data = await fetchJson(u,{},"Pixabay");
  const selected = [];
  for (const hit of data.hits || []) {
    if (!hit.id || seen.has("pixabay:" + hit.id) || !hit.largeImageURL || !hit.pageURL) continue;
    if ((hit.imageWidth||0) < MIN_WIDTH || (hit.imageHeight||0) < MIN_HEIGHT) continue;
    const file = path.join(out,"pixabay-" + hit.id + ".jpg");
    try {
      const got = await download(hit.webformatURL || hit.largeImageURL,file);
      seen.add("pixabay:" + hit.id);
      selected.push(addAsset({
        scene:sceneNo,kind:"photo",provider:"Pixabay",title:hit.tags || query,
        creator:hit.user || "Pixabay contributor",tags:hit.tags || query,sourcePage:hit.pageURL,
        previewFile:path.basename(file),license:"Pixabay Content License",licenseUrl:"https://pixabay.com/service/license-summary/",
        licenseEvidence:"https://pixabay.com/service/license-summary/",attributionRequired:false,
        attribution:"Pixabay contributor " + (hit.user || "unknown"),mediaUrl:got.url,searchQuery:query,
        width:hit.imageWidth,height:hit.imageHeight,mimeType:got.contentType || "image/jpeg",bytes:got.bytes
      }));
      if (selected.length >= max) break;
    } catch(e) { warnings.push("Pixabay " + hit.id + ": " + e.message); }
  }
  return selected;
}
async function main() {
  const script = JSON.parse(await readFile(path.join(root,"script.json"),"utf8"));
  if (!Array.isArray(script.scenes) || !script.scenes.length) throw new Error("script.json has no scenes.");
  await mkdir(out,{recursive:true});
  const providersUsed = new Set();
  for (let i=0;i<script.scenes.length;i++) {
    const scene = script.scenes[i], sceneNo = i+1, queries = sceneQueries(scene);
    if (!queries.length) throw new Error("Scene " + sceneNo + " has no usable visual search terms.");
    const start = assets.length;
    // Each provider is deliberately called; missing optional keys are reported and do not abort discovery.
    for (const q of queries.slice(0,2)) {
      const got = await commonsSearch(q,sceneNo,2);
      if (got.length) providersUsed.add("Wikimedia Commons");
      if (assets.filter(a=>a.scene===sceneNo&&a.kind!=="video").length >= 2) break;
    }
    const ia = await internetArchiveSearch(queries[0],sceneNo,1);
    if (ia.length) providersUsed.add("Internet Archive");
    const generated = await pollinationsImage(queries[0],sceneNo,1);
    if (generated) providersUsed.add("Pollinations");
    const unsplash = await unsplashSearch(queries[0],sceneNo,2);
    if (unsplash.length) providersUsed.add("Unsplash");
    const pixabay = await pixabaySearch(queries[0],sceneNo,3);
    if (pixabay.length) providersUsed.add("Pixabay");
    // Ensure each scene has at least one provenance-recorded photo; the renderer can reuse it across beats.
    let photos = assets.filter(a=>a.scene===sceneNo&&a.kind!=="video");
    if (photos.length < 1) {
      for (const q of queries.slice(1)) {
        if (photos.length >= 1) break;
        const c = await commonsSearch(q,sceneNo,1-photos.length);
        if (c.length) providersUsed.add("Wikimedia Commons");
        photos = assets.filter(a=>a.scene===sceneNo&&a.kind!=="video");
      }
    }
    if (photos.length < 1) {
      for (const q of queries.slice(1)) {
        if (photos.length >= 1) break;
        const p = await pixabaySearch(q,sceneNo,1-photos.length);
        if (p.length) providersUsed.add("Pixabay");
        photos = assets.filter(a=>a.scene===sceneNo&&a.kind!=="video");
      }
    }
    if (photos.length < 1) {
      throw new Error("Scene " + sceneNo + " (" + scene.title + ") has only " + photos.length + " cleared/provenance-recorded photos; Refine scene keywords/visual queries or configure an image provider key.");
    }
    const sceneAssets = assets.filter(a=>a.scene===sceneNo);
    selection.push({
      scene:sceneNo,title:scene.title,queries,
      selectedImageIds:photos.map(a=>a.id),
      selectedVideoIds:sceneAssets.filter(a=>a.kind==="video").map(a=>a.id),
      providers:[...new Set(sceneAssets.map(a=>a.provider))]
    });
    console.log("Scene " + sceneNo + ": " + photos.length + " photos, " + sceneAssets.filter(a=>a.kind==="video").length + " clips; " + selection.at(-1).providers.join(", "));
    if (assets.length===start) throw new Error("No assets acquired for scene " + sceneNo + ".");
  }
  const manifest = {
    projectId,source:"Multi-provider scene-matched acquisition",
    providers:["Wikimedia Commons","Internet Archive","Pollinations","Unsplash","Pixabay"],
    providersUsed:[...providersUsed],assetCount:assets.length,assets,
    rightsPolicy:"Only Commons files with recognized public-domain/CC BY/CC BY-SA terms and Internet Archive videos with recognized public-domain/CC BY/CC BY-SA terms are acquired. Unsplash/Pixabay terms and attribution metadata are retained. Pollinations output is labeled AI-generated and illustrative. Every asset requires editorial verification before publication.",
    warnings
  };
  await writeFile(path.join(root,"visual-selection.json"),JSON.stringify({projectId,title:script.title,source:manifest.source,scenes:selection},null,2)+"\n");
  await writeFile(path.join(root,"visual-assets.json"),JSON.stringify(manifest,null,2)+"\n");
  // Contact sheet for editorial inspection.
  const cols=5,cellW=320,cellH=180,labelH=48,gap=10,margin=10,rows=Math.ceil(sheetItems.length/cols);
  const parts=['<svg xmlns="http://www.w3.org/2000/svg" width="'+(margin*2+cols*cellW+(cols-1)*gap)+'" height="'+(margin*2+rows*(cellH+labelH)+(rows-1)*gap)+'">','<rect width="100%" height="100%" fill="#090b0e"/>'];
  for(let i=0;i<sheetItems.length;i++){
    const x=margin+(i%cols)*(cellW+gap),y=margin+Math.floor(i/cols)*(cellH+labelH+gap),item=sheetItems[i];
    const data=(await readFile(item.file)).toString("base64"), mime=String(item.mimeType || "image/jpeg").split(";")[0];
    parts.push('<rect x="'+x+'" y="'+y+'" width="'+cellW+'" height="'+(cellH+labelH)+'" fill="#171a1e"/>');
    parts.push('<image x="'+x+'" y="'+y+'" width="'+cellW+'" height="'+cellH+'" preserveAspectRatio="xMidYMid slice" href="data:'+esc(mime)+';base64,'+data+'"/>');
    parts.push('<text x="'+(x+12)+'" y="'+(y+cellH+23)+'" fill="#f0ede5" font-family="DejaVu Sans" font-size="16" font-weight="bold">'+esc(item.id)+' • SCENE '+item.scene+'</text>');
    parts.push('<text x="'+(x+12)+'" y="'+(y+cellH+44)+'" fill="#bdb6aa" font-family="DejaVu Sans" font-size="11">'+esc(String(item.tags).slice(0,72))+'</text>');
  }
  parts.push("</svg>");
  const svg=path.join(out,"contact-sheet.svg");
  await writeFile(svg,parts.join(""));
  await new Promise((resolve,reject)=>{const p=spawn("rsvg-convert",["-f","png","-o",path.join(out,"contact-sheet.png"),svg],{stdio:"inherit"});p.on("error",reject);p.on("close",c=>c===0?resolve():reject(new Error("rsvg-convert failed")));});
  await new Promise((resolve,reject)=>{const p=spawn("ffmpeg",["-y","-i",path.join(out,"contact-sheet.png"),"-frames:v","1","-q:v","2",path.join(out,"contact-sheet.jpg")],{stdio:"inherit"});p.on("error",reject);p.on("close",c=>c===0?resolve():reject(new Error("contact sheet JPEG failed")));});
  console.log(JSON.stringify({projectId,scenes:script.scenes.length,assetCount:assets.length,providersUsed:[...providersUsed],warnings},null,2));
}
main().catch(error=>{console.error(error);process.exit(1);});
