import { mkdir, readFile, writeFile, copyFile, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const PROJECT_ID = process.env.PROJECT_ID;
if (!PROJECT_ID || !/^[a-z0-9-]+$/.test(PROJECT_ID)) throw new Error("PROJECT_ID is missing or invalid.");
const ROOT = path.join("production", "projects", PROJECT_ID);
const OUT = path.join("dist", PROJECT_ID);
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID;
const PEXELS_API_KEY = process.env.PEXELS_API_KEY;
const NARRATION_CACHE_DIR = process.env.NARRATION_CACHE_DIR || "";

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

function overlaySvg(scene, index, total) {
  const title = lines((scene.title || "").toUpperCase(), 28).slice(0, 2)
    .map((s,i) => '<text x="120" y="' + (760 + i*76) + '" class="title">' + xml(s) + '</text>').join("");
  const subtitle = lines(scene.subtitle || "", 58).slice(0, 2)
    .map((s,i) => '<text x="124" y="' + (930 + i*38) + '" class="sub">' + xml(s) + '</text>').join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">
  <defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#08090b" stop-opacity=".25"/><stop offset=".48" stop-color="#08090b" stop-opacity=".05"/><stop offset="1" stop-color="#08090b" stop-opacity=".92"/></linearGradient></defs>
  <rect width="1920" height="1080" fill="url(#shade)"/>
  <rect x="120" y="112" width="7" height="68" fill="#A8794D"/>
  <text x="154" y="145" class="brand">THE HIDDEN ENGINE</text>
  <text x="154" y="180" class="kicker">BUSINESS • STRATEGY • THE HIDDEN ECONOMICS</text>
  <text x="120" y="710" class="eyebrow">THE INVESTIGATION / ${String(index+1).padStart(2,"0")}</text>
  ${title}${subtitle}
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
async function elevenLabs(text, output) {
  if (!ELEVENLABS_API_KEY || !ELEVENLABS_VOICE_ID) throw new Error("Narration cache is missing and ElevenLabs credentials are unavailable.");
  const response = await fetch("https://api.elevenlabs.io/v1/text-to-speech/" + encodeURIComponent(ELEVENLABS_VOICE_ID), {
    method: "POST",
    headers: { "xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json", "Accept": "audio/mpeg" },
    body: JSON.stringify({
      text, model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.48, similarity_boost: 0.78, style: 0.18, use_speaker_boost: true }
    })
  });
  if (!response.ok) throw new Error("ElevenLabs TTS failed (" + response.status + "): " + (await response.text()).slice(0, 500));
  await writeFile(output, Buffer.from(await response.arrayBuffer()));
}
async function createSoundDesign(narration, sfx, mixed) {
  // A short, restrained transition whoosh only. No music bed is generated or added.
  await run("ffmpeg", ["-y","-i",narration,"-f","lavfi","-i","anoisesrc=color=pink:duration=1.15:sample_rate=44100",
    "-filter_complex","[1:a]highpass=f=220,lowpass=f=1700,afade=t=in:st=0:d=0.12,afade=t=out:st=0.35:d=0.75,volume=0.09[sfx];[0:a][sfx]amix=inputs=2:duration=first:dropout_transition=0,loudnorm=I=-16:TP=-1.5:LRA=11[a]",
    "-map","[a]","-c:a","libmp3lame","-b:a","192k",mixed]);
}
async function findPexelsImage(query) {
  if (!PEXELS_API_KEY || !String(query || "").trim()) return null;
  const endpoint = "https://api.pexels.com/v1/search?query=" + encodeURIComponent(query) + "&orientation=landscape&per_page=8";
  const response = await fetchWithTimeout(endpoint,{headers:{Authorization:PEXELS_API_KEY}});
  if (!response.ok) throw new Error("Pexels photo search failed ("+response.status+"): "+(await response.text()).slice(0,300));
  const data=await response.json();
  const photos=(data.photos||[]).filter(p=>p.src && (p.src.landscape||p.src.large2x||p.src.large));
  photos.sort((a,b)=>(b.width*b.height)-(a.width*a.height));
  const p=photos[0];
  return p ? {url:p.src.landscape||p.src.large2x||p.src.large,page:p.url,creator:p.photographer||"Unknown creator",creatorUrl:p.photographer_url||""} : null;
}
async function findCommonsImage(query) {
  const raw = String(query || "").trim();
  if (!raw) return null;
  const terms = raw.split(/\\s+/);
  const searches = [...new Set([raw, terms.slice(0,3).join(" "), terms.slice(0,2).join(" ")])];
  const allowed = /^(CC0|Public domain|CC BY(?:-|\\s)|CC BY-SA)/i;
  const clean = value => String(value || "").replace(/<[^>]*>/g,"").replace(/&nbsp;/g," ").trim();
  for (const q of searches) {
    const endpoint = "https://commons.wikimedia.org/w/api.php?action=query&list=search&srnamespace=6&srlimit=20&srsearch=" +
      encodeURIComponent(q) + "&format=json";
    const response = await fetchWithTimeout(endpoint, {
      headers: { "User-Agent": "HiddenEngineDocumentaryBot/1.0 (asset attribution and license verification)" }
    });
    if (!response.ok) throw new Error("Wikimedia Commons search failed ("+response.status+").");
    const data = await response.json();
    const titles = (data.query?.search || []).map(item => item.title).filter(Boolean);
    console.log("Wikimedia Commons query ["+q+"] returned "+titles.length+" file candidates.");
    if (!titles.length) continue;
    const detailsUrl = "https://commons.wikimedia.org/w/api.php?action=query&titles=" +
      encodeURIComponent(titles.join("|")) + "&prop=imageinfo&iiprop=url|mime|extmetadata&iiurlwidth=1920&format=json";
    const detailsResponse = await fetchWithTimeout(detailsUrl, {
      headers: { "User-Agent": "HiddenEngineDocumentaryBot/1.0 (asset attribution and license verification)" }
    });
    if (!detailsResponse.ok) throw new Error("Wikimedia Commons image details failed ("+detailsResponse.status+").");
    const details = await detailsResponse.json();
    for (const page of Object.values(details.query?.pages || {})) {
      const info = page.imageinfo?.[0];
      if (!info || !/^image\\/(jpeg|png|webp)$/i.test(info.mime || "")) continue;
      const meta = info.extmetadata || {};
      const license = clean(meta.LicenseShortName?.value);
      if (!allowed.test(license)) continue;
      return {
        url: info.thumburl || info.url,
        page: info.descriptionurl || ("https://commons.wikimedia.org/wiki/" + encodeURIComponent(page.title.replace(/ /g,"_"))),
        creator: clean(meta.Artist?.value || "Unknown creator"),
        license,
        licenseUrl: clean(meta.LicenseUrl?.value || ""),
        attribution: clean(meta.AttributionRequired?.value || "")
      };
    }
  }
  return null;
}
async function findOpenverseImage(query) {
  const q = String(query || "").trim();
  if (!q) return null;
  const endpoint = "https://api.openverse.org/v1/images/?q=" + encodeURIComponent(q) +
    "&license=cc0,pdm,by,by-sa&aspect_ratio=wide&page_size=10";
  const response = await fetchWithTimeout(endpoint, {
    headers: { "User-Agent": "HiddenEngineDocumentaryBot/1.0 (licensed visual discovery)" }
  });
  if (!response.ok) throw new Error("Openverse image search failed ("+response.status+").");
  const data = await response.json();
  const results = (data.results || []).filter(item => item.url && item.license && /^(cc0|pdm|by|by-sa)$/i.test(item.license));
  console.log("Openverse query ["+q+"] returned "+results.length+" licensed images.");
  const item = results.find(result => result.thumbnail || result.url);
  return item ? {
    url: item.thumbnail || item.url,
    page: item.foreign_landing_url || item.detail_url || item.url,
    creator: item.creator || "Unknown creator",
    license: String(item.license).toUpperCase(),
    licenseUrl: item.license_url || "",
    creatorUrl: item.creator_url || ""
  } : null;
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
    video.url && video.video_files?.some(file => file.link && /mp4/i.test(file.file_type || ""))
  );
  videos.sort((a,b) => (b.width*b.height) - (a.width*a.height));
  for (const video of videos) {
    const files = video.video_files.filter(file => file.link && /mp4/i.test(file.file_type || ""));
    files.sort((a,b) => (b.width*b.height) - (a.width*a.height));
    const file = files.find(item => item.width >= 1280) || files[0];
    if (!file) continue;
    return {
      url: file.link, page: video.url, creator: video.user?.name || "Unknown creator",
      creatorUrl: video.user?.url || "", duration: video.duration
    };
  }
  return null;
}
async function download(url, dest) {
  const response = await fetchWithTimeout(url, {}, 20000);
  if (!response.ok) throw new Error("Asset download failed (" + response.status + ").");
  await writeFile(dest, Buffer.from(await response.arrayBuffer()));
}
async function main() {
  const script = JSON.parse(await readFile(path.join(ROOT, "script.json"), "utf8"));
  if (!NARRATION_CACHE_DIR && (!ELEVENLABS_API_KEY || !ELEVENLABS_VOICE_ID)) {
    throw new Error("Natural narration requires cached audio or ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID.");
  }
  if (!Array.isArray(script.scenes) || !script.scenes.length) throw new Error("script.json has no scenes.");
  await mkdir(OUT, { recursive: true });
  const clips = [], credits = [];
  for (let i=0; i<script.scenes.length; i++) {
    const scene = script.scenes[i];
    if (!scene.narration?.trim()) throw new Error("Scene " + (i+1) + " has no narration.");
    const stem = "scene-" + String(i+1).padStart(2,"0");
    const audio = path.join(OUT, stem + ".mp3");
    const mixedAudio = path.join(OUT, stem + "-sound-designed.mp3");
    const sfx = path.join(OUT, stem + "-transition.wav");
    const svg = path.join(OUT, stem + ".svg");
    const clip = path.join(OUT, stem + "-visual.mp4");
    const rendered = path.join(OUT, stem + ".mp4");
    let reusedNarration = false;
    if (NARRATION_CACHE_DIR) {
      const cached = path.join(NARRATION_CACHE_DIR, stem + ".mp3");
      try {
        await access(cached);
        await copyFile(cached, audio);
        reusedNarration = true;
        console.log("Reusing verified project narration cache for scene " + (i+1));
      } catch {}
    }
    if (!reusedNarration) await elevenLabs(scene.narration, audio);
    await createSoundDesign(audio, sfx, mixedAudio);
    await writeFile(svg, overlaySvg(scene, i, script.scenes.length));
    const query = scene.visual_query || [scene.title, scene.subtitle].filter(Boolean).join(" ");
    console.log("Pexels key configured: " + Boolean(PEXELS_API_KEY));
    console.log("Searching visual asset for scene " + (i+1) + ": " + query);
    let asset = await findPexelsVideo(query);
    let still = null;
    if (!asset) still = await findPexelsImage(query);
    if (!asset && !still) still = await findCommonsImage(query);
    if (!asset && !still) still = await findOpenverseImage(query);
    if (asset) console.log("Pexels video selected for scene " + (i+1));
    else if (still) console.log((still.license ? "Wikimedia Commons image ("+still.license+")" : "Pexels photo") + " selected for scene " + (i+1));
    else console.log("No licensed stock asset found for scene " + (i+1));
    if (asset) {
      await download(asset.url, clip);
      credits.push({ scene: i+1, query, provider:"Pexels video", page:asset.page, creator:asset.creator, creatorUrl:asset.creatorUrl, usage:"Illustrative footage; not proof of a named event or entity." });
      await run("ffmpeg", ["-y","-stream_loop","-1","-i",clip,"-i",mixedAudio,"-loop","1","-i",svg,
        "-filter_complex","[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,eq=contrast=1.12:saturation=0.78,drawbox=x=0:y=0:w=iw:h=ih:color=#08090b@0.18:t=fill[bg];[bg][2:v]overlay=0:0,format=yuv420p[v]",
        "-map","[v]","-map","1:a","-c:v","libx264","-preset","veryfast","-crf","21","-c:a","aac","-b:a","192k","-shortest","-movflags","+faststart",rendered]);
    } else if (still) {
      const imagePath=clip.replace(/\.mp4$/,".jpg");
      await download(still.url, imagePath);
      credits.push({ scene:i+1, query, provider:still.license ? "Wikimedia Commons photo" : "Pexels photo", page:still.page, creator:still.creator, creatorUrl:still.creatorUrl || "", license:still.license || "Pexels License", licenseUrl:still.licenseUrl || "", usage:"Illustrative still; not proof of a named event or entity." });
      await run("ffmpeg", ["-y","-loop","1","-i",imagePath,"-i",mixedAudio,"-loop","1","-i",svg,
        "-filter_complex","[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,zoompan=z='min(zoom+0.0003,1.07)':d=125:s=1920x1080:fps=25,eq=contrast=1.08:saturation=0.82[bg];[bg][2:v]overlay=0:0,format=yuv420p[v]",
        "-map","[v]","-map","1:a","-c:v","libx264","-preset","veryfast","-crf","21","-c:a","aac","-b:a","192k","-shortest","-movflags","+faststart",rendered]);
    } else {
      credits.push({ scene:i+1, query, provider:"Original motion graphic", note:"No matching Pexels video or photo was returned; generated a branded animated graphic instead." });
      await run("ffmpeg", ["-y","-f","lavfi","-i","color=c=#101113:s=1920x1080:r=25","-i",mixedAudio,"-loop","1","-i",svg,
        "-filter_complex","[0:v]zoompan=z='min(zoom+0.00035,1.08)':d=125:s=1920x1080:fps=25,format=yuv420p[bg];[bg][2:v]overlay=0:0,format=yuv420p[v]",
        "-map","[v]","-map","1:a","-c:v","libx264","-preset","veryfast","-crf","21","-c:a","aac","-b:a","192k","-shortest","-movflags","+faststart",rendered]);
    }
    clips.push(rendered);
    console.log("Rendered scene " + (i+1) + "/" + script.scenes.length + (asset ? " with licensed stock footage." : " with branded motion graphics."));
  }
  const stockScenes = credits.filter(item => item.provider === "Pexels video" || item.provider === "Pexels photo" || item.provider === "Wikimedia Commons photo").length;
  const minimumStockScenes = Math.min(4, script.scenes.length);
  if (stockScenes < minimumStockScenes) {
    throw new Error("Visual QA failed: only " + stockScenes + "/" + script.scenes.length + " scenes have licensed photographic/video assets; minimum required is " + minimumStockScenes + ". Check PEXELS_API_KEY or Wikimedia Commons availability. Refusing to publish another graphics-only render.");
  }
  const list = path.join(OUT,"concat.txt");
  await writeFile(list, clips.map(f=>"file '"+path.basename(f)+"'").join("\n")+"\n");
  const output = path.join(OUT,"the-hidden-engine-documentary.mp4");
  await run("ffmpeg",["-y","-f","concat","-safe","0","-i",list,"-c","copy","-movflags","+faststart",output]);
  await writeFile(path.join(OUT,"visual-credits.json"),JSON.stringify(credits,null,2)+"\n");
  await writeFile(path.join(OUT,"CREDITS.md"),[
    "# Visual credits","",
    "Stock photos/videos are sourced from Pexels or Wikimedia Commons. Review each linked asset page and license before publication.",
    "Pexels footage is used as illustrative material and must not be presented as actual footage of a specific company, person, product, or event unless independently verified.",
    "",
    ...credits.map(c=>c.page
      ? "- Scene "+c.scene+": ["+c.provider+"]("+c.page+") — "+c.creator+" — "+(c.license||"Pexels License")+(c.licenseUrl?" ("+c.licenseUrl+")":"")
      : "- Scene "+c.scene+": "+c.provider+" — "+c.note)
  ].join("\n")+"\n");
  await writeFile(path.join(OUT,"README.txt"),[
    "The Hidden Engine documentary render",
    "Narration: ElevenLabs API (natural AI voice; selected voice configured by repository secret/variable).",
    "Visuals: Pexels stock video or photos where relevant; otherwise original branded motion graphics.",
    "Audio: ElevenLabs narration with restrained generated transition sound effects; no background music.",
    "Identity: charcoal/black, ivory typography, restrained copper accents, documentary-investigative overlays.",
    "Review all claims, pronunciations, visual relevance, licenses, and credits before publication.",
    "No automatic YouTube upload."
  ].join("\n")+"\n");
  const qa = await new Promise((resolve,reject) => { const p=spawn("ffprobe",["-v","error","-show_entries","format=duration:stream=codec_type,width,height","-of","json",output]); let data=""; p.stdout.on("data",d=>data+=d); p.on("error",reject); p.on("close",code=>code===0?resolve(JSON.parse(data)):reject(new Error("ffprobe failed"))); });
  if (!qa.streams.some(x=>x.codec_type==="video" && x.width===1920 && x.height===1080) || !qa.streams.some(x=>x.codec_type==="audio")) throw new Error("Final MP4 failed audio/1080p QA.");
  await writeFile(path.join(OUT,"QA-REPORT.json"),JSON.stringify({file:path.basename(output),width:1920,height:1080,duration:Number(qa.format.duration),audio:true,audioDesign:"narration_plus_subtle_transition_sfx_no_music",scenes:clips.length,visualProviders:[...new Set(credits.map(c=>c.provider))]},null,2)+"\n");
  console.log("Rendered and passed technical QA: "+output);
}
main().catch(error=>{console.error("Render failed:",error);process.exit(1);});
