import { access, mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const PROJECT_ID = process.env.PROJECT_ID;
if (!PROJECT_ID || !/^[a-z0-9-]+$/.test(PROJECT_ID)) throw new Error("PROJECT_ID is missing or invalid.");
const ROOT = path.join("production", "projects", PROJECT_ID);
const OUT = path.join("dist", PROJECT_ID);
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID;
const PEXELS_API_KEY = process.env.PEXELS_API_KEY;
const PIXABAY_API_KEY = process.env.PIXABAY_API_KEY;
const PIPER_EXECUTABLE = process.env.PIPER_EXECUTABLE || "piper";
const PIPER_MODEL = process.env.PIPER_MODEL || "models/piper-voice.onnx";
const PIPER_LENGTH_SCALE = Number(process.env.PIPER_LENGTH_SCALE || "1.0");

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
async function capture(command, args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", d => stdout += d);
    child.stderr.on("data", d => stderr += d);
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve({stdout,stderr}) : reject(new Error(command + " exited with code " + code + ": " + stderr.slice(-1200))));
  });
}
async function piperTTS(text, output) {
  if (!Number.isFinite(PIPER_LENGTH_SCALE) || PIPER_LENGTH_SCALE <= 0) throw new Error("PIPER_LENGTH_SCALE must be a positive number.");
  await access(PIPER_MODEL).catch(() => { throw new Error("Piper voice model not found: " + PIPER_MODEL); });
  await access(PIPER_MODEL + ".json").catch(() => { throw new Error("Piper voice config not found: " + PIPER_MODEL + ".json"); });

  // Piper's CLI treats newline-delimited input as separate utterances. Passing a
  // multi-paragraph scene to one --output_file can leave only the last utterance
  // in the WAV. Synthesize bounded, single-line chunks and concatenate every part.
  const normalized = String(text).replace(/\s+/g, " ").trim();
  if (!normalized) throw new Error("Narration text is empty.");
  const sentences = normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [normalized];
  const chunks = [];
  let chunk = [];
  let count = 0;
  for (const sentence of sentences) {
    const words = sentence.trim().split(/\s+/).filter(Boolean);
    let offset = 0;
    while (offset < words.length) {
      const room = Math.max(1, 55 - count);
      const take = words.slice(offset, offset + room);
      chunk.push(take.join(" "));
      count += take.length;
      offset += take.length;
      if (count >= 55) {
        chunks.push(chunk.join(" "));
        chunk = [];
        count = 0;
      }
    }
  }
  if (chunk.length) chunks.push(chunk.join(" "));

  const directory = path.dirname(output);
  const stem = path.basename(output, path.extname(output));
  const parts = [];
  for (let i = 0; i < chunks.length; i++) {
    const part = path.join(directory, stem + ".part-" + String(i + 1).padStart(3, "0") + ".wav");
    await new Promise((resolve, reject) => {
      const child = spawn(PIPER_EXECUTABLE, ["--model", PIPER_MODEL, "--output_file", part, "--length_scale", String(PIPER_LENGTH_SCALE)], { stdio: ["pipe", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", value => stderr += value);
      child.on("error", reject);
      child.on("close", code => code === 0 ? resolve() : reject(new Error("Piper TTS chunk " + (i + 1) + "/" + chunks.length + " exited with code " + code + ": " + stderr.slice(-1200))));
      child.stdin.on("error", reject);
      child.stdin.end(chunks[i]);
    });
    const duration = await probeDuration(part);
    if (!(duration > 0)) throw new Error("Piper produced an empty narration chunk " + (i + 1) + ".");
    parts.push(part);
  }

  const concatList = path.join(directory, stem + ".parts.txt");
  await writeFile(concatList, parts.map(file => "file '" + path.basename(file).replace(/'/g, "'\\''") + "'").join("\n") + "\n");
  await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", concatList, "-c", "copy", output]);
  const probe = await capture("ffprobe", ["-v","error","-show_entries","format=duration","-of","default=noprint_wrappers=1:nokey=1",output]);
  const duration = Number(probe.stdout.trim());
  if (!(duration > 0)) throw new Error("Piper produced an empty narration file.");
  console.log("Synthesized complete narration: " + chunks.length + " chunks, " + duration.toFixed(1) + " seconds, length scale " + PIPER_LENGTH_SCALE + ".");
  return duration;
}
async function findPexelsVideo(query) {
  // Do not pass generic stock footage off as company-specific evidence.
  return null;
  if (!PEXELS_API_KEY) return null;
  const response = await fetch("https://api.pexels.com/videos/search?query=" + encodeURIComponent(query) + "&orientation=landscape&per_page=8", {
    headers: { Authorization: PEXELS_API_KEY }
  });
  if (!response.ok) throw new Error("Pexels search failed (" + response.status + ").");
  const data = await response.json();
  const videos = (data.videos || []).filter(v => v.video_files?.length);
  videos.sort((a,b) => (b.width*b.height) - (a.width*a.height));
  const video = videos[0];
  if (!video) return null;
  const file = video.video_files.find(f => f.width >= 1280 && /mp4/i.test(f.file_type || "")) ||
    video.video_files.find(f => /mp4/i.test(f.file_type || ""));
  if (!file) return null;
  return {
    url: file.link, page: video.url, creator: video.user?.name || "Unknown creator",
    creatorUrl: video.user?.url || "", duration: video.duration
  };
}
async function probeDuration(file) {
  return await new Promise((resolve, reject) => {
    const p = spawn("ffprobe", ["-v","error","-show_entries","format=duration","-of","default=noprint_wrappers=1:nokey=1",file]);
    let data = "";
    p.stdout.on("data", d => data += d);
    p.on("error", reject);
    p.on("close", code => code === 0 && Number.isFinite(Number(data.trim())) ? resolve(Number(data.trim())) : reject(new Error("Could not read audio duration")));
  });
}
async function pixabayImageUrl(pageUrl) {
  if (!PIXABAY_API_KEY) throw new Error("PIXABAY_API_KEY is required to retrieve approved image assets.");
  const match = String(pageUrl).match(/-(\d+)\/?(?:\?.*)?$/);
  if (!match) throw new Error("Could not extract Pixabay image ID from " + pageUrl);
  const api = new URL("https://pixabay.com/api/");
  api.searchParams.set("key", PIXABAY_API_KEY);
  api.searchParams.set("id", match[1]);
  api.searchParams.set("safesearch", "true");
  const response = await fetch(api);
  if (!response.ok) throw new Error("Pixabay API failed (" + response.status + ") for image " + match[1]);
  const data = await response.json();
  const hit = data.hits?.find(item => String(item.id) === match[1]);
  const imageUrl = hit?.largeImageURL || hit?.webformatURL;
  if (!imageUrl) throw new Error("Pixabay API returned no downloadable image for ID " + match[1]);
  return imageUrl;
}
async function download(url, dest) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Asset download failed (" + response.status + ").");
  await writeFile(dest, Buffer.from(await response.arrayBuffer()));
}
async function main() {
  if (!PIPER_EXECUTABLE || !PIPER_MODEL) throw new Error("Piper TTS is not configured.");
  const script = JSON.parse(await readFile(path.join(ROOT, "script.json"), "utf8"));
  if (!Array.isArray(script.scenes) || !script.scenes.length) throw new Error("script.json has no scenes.");
  await mkdir(OUT, { recursive: true });
  const selectionPath = path.join(ROOT, "visual-selection.json");
  const assetsPath = path.join(ROOT, "visual-assets.json");
  const selection = JSON.parse(await readFile(selectionPath, "utf8"));
  const assetsManifest = JSON.parse(await readFile(assetsPath, "utf8"));
  const assetById = new Map((assetsManifest.assets || []).map(asset => [asset.id, asset]));
  const clips = [], credits = [], visualAudit = [];
  for (let i=0; i<script.scenes.length; i++) {
    const scene = script.scenes[i];
    if (!scene.narration?.trim()) throw new Error("Scene " + (i+1) + " has no narration.");
    const stem = "scene-" + String(i+1).padStart(2,"0");
    const audio = path.join(OUT, stem + ".wav");
    const svg = path.join(OUT, stem + ".svg");
    const rendered = path.join(OUT, stem + ".mp4");
    await piperTTS(scene.narration, audio);
    await writeFile(svg, overlaySvg(scene, i, script.scenes.length));
    const selected = selection.scenes.find(item => item.scene === i+1)?.selectedImageIds || [];
    if (!selected.length) throw new Error("Scene " + (i+1) + " has no approved visual selections.");
    const imageFiles = [];
    for (const id of selected) {
      const asset = assetById.get(id);
      if (!asset || asset.scene !== i+1) throw new Error("Selected image " + id + " is missing or assigned to the wrong scene.");
      const imageFile = path.join(OUT, id + ".jpg");
      if (!await stat(imageFile).then(()=>true).catch(()=>false)) {
        const imageUrl = await pixabayImageUrl(asset.sourcePage);
        await download(imageUrl, imageFile);
      }
      imageFiles.push(imageFile);
      credits.push({ scene:i+1, imageId:id, provider:"Pixabay", page:asset.sourcePage, creator:asset.creator,
        tags:asset.tags, license:asset.license, licenseUrl:asset.licenseUrl, illustrative:true });
    }
    const audioDuration = await probeDuration(audio);
    const transition = imageFiles.length > 1 ? 0.65 : 0;
    const segmentDuration = imageFiles.length > 1 ? (audioDuration + transition * (imageFiles.length - 1)) / imageFiles.length : audioDuration;
    const args = ["-y"];
    for (const imageFile of imageFiles) args.push("-loop","1","-t",segmentDuration.toFixed(3),"-i",imageFile);
    const audioIndex = imageFiles.length;
    const svgIndex = imageFiles.length + 1;
    args.push("-i",audio,"-loop","1","-i",svg);
    const filters = [];
    for (let n=0;n<imageFiles.length;n++) {
      const zoom = n % 2 === 0 ? "min(zoom+0.00045,1.12)" : "min(zoom+0.00038,1.10)";
      filters.push("["+n+":v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,zoompan=z='"+zoom+"':d=1:s=1920x1080:fps=25,setsar=1,format=yuv420p[v"+n+"]");
    }
    let baseLabel = "v0";
    for (let n=1;n<imageFiles.length;n++) {
      const nextLabel = "mix"+n;
      const offset = Math.max(0, (n+1)*segmentDuration - n*transition - transition);
      filters.push("["+baseLabel+"][v"+n+"]xfade=transition=fade:duration="+transition+":offset="+offset.toFixed(3)+"["+nextLabel+"]");
      baseLabel = nextLabel;
    }
    filters.push("["+baseLabel+"]["+svgIndex+":v]overlay=0:0:shortest=1,format=yuv420p[v]");
    args.push("-filter_complex",filters.join(";"),"-map","[v]","-map",audioIndex+":a",
      "-c:v","libx264","-preset","veryfast","-crf","20","-c:a","aac","-b:a","192k",
      "-t",audioDuration.toFixed(3),"-shortest","-movflags","+faststart",rendered);
    await run("ffmpeg",args);
    visualAudit.push({scene:i+1,selectedImageIds:selected,renderedImages:imageFiles.length,animated:true,
      sourceTags:selected.map(id=>assetById.get(id).tags)});
    clips.push(rendered);
    console.log("Rendered scene "+(i+1)+"/"+script.scenes.length+" with "+imageFiles.length+" selected stills, frequent crossfades and cinematic motion.");
  }
  const list = path.join(OUT,"concat.txt");
  await writeFile(list, clips.map(f=>"file '"+path.basename(f)+"'").join("\n")+"\n");
  const output = path.join(OUT,"the-hidden-engine-documentary.mp4");
  await run("ffmpeg",["-y","-f","concat","-safe","0","-i",list,"-c","copy","-movflags","+faststart",output]);
  await writeFile(path.join(OUT,"visual-credits.json"),JSON.stringify(credits,null,2)+"\n");
  await writeFile(path.join(OUT,"VISUAL-AUDIT.json"),JSON.stringify(visualAudit,null,2)+"\n");
  await writeFile(path.join(OUT,"CREDITS.md"),[
    "# Visual credits","",
    "Selected still images are sourced from Pixabay. Review each linked asset page and applicable license before publication.",
    "All selected stills are illustrative stock imagery, not evidence of a specific company, person, product, or event unless independently verified.",
    "",
    ...credits.map(c=>"imageId" in c
      ? "- Scene "+c.scene+" ("+c.imageId+"): [Pixabay image]("+c.page+") — "+c.creator+"; illustrative stock image. License: [Pixabay Content License]("+c.licenseUrl+")"
      : "- Scene "+c.scene+": "+c.provider+" — "+c.note)
  ].join("\n")+"\n");
  await writeFile(path.join(OUT,"README.txt"),[
    "The Hidden Engine documentary render",
    "Narration: Local Piper neural TTS (no paid API quota required).",
    "Visuals: user-selected Pixabay stills with animated camera movement, crossfades, and original data overlays.",
    "Identity: charcoal/black, ivory typography, restrained copper accents, documentary-investigative overlays.",
    "Review all claims, pronunciations, visual relevance, licenses, and credits before publication.",
    "No automatic YouTube upload."
  ].join("\n")+"\n");
  const qa = await new Promise((resolve,reject) => { const p=spawn("ffprobe",["-v","error","-show_entries","format=duration:stream=codec_type,width,height","-of","json",output]); let data=""; p.stdout.on("data",d=>data+=d); p.on("error",reject); p.on("close",code=>code===0?resolve(JSON.parse(data)):reject(new Error("ffprobe failed"))); });
  const finalDuration = Number(qa.format.duration);
  if (!qa.streams.some(x=>x.codec_type==="video" && x.width===1920 && x.height===1080) || !qa.streams.some(x=>x.codec_type==="audio")) throw new Error("Final MP4 failed audio/1080p QA.");
  if (finalDuration < 13*60 || finalDuration > 18*60) throw new Error("Final runtime "+finalDuration.toFixed(1)+"s is outside the 13–18 minute documentary target.");
  if (visualAudit.some(x=>x.renderedImages < 5)) throw new Error("A scene has fewer than five distinct visuals.");
  await access(path.join(OUT,"contact-sheet.jpg")).catch(()=>{throw new Error("Final contact-sheet.jpg is missing.");});
  await writeFile(path.join(OUT,"QA-REPORT.json"),JSON.stringify({file:path.basename(output),width:1920,height:1080,duration:finalDuration,targetDurationMinutes:15,acceptedDurationRangeMinutes:[13,18],audio:true,scenes:clips.length,selectedImages:credits.length,imagesPerScene:5,visualChangeTargetSeconds:7,animatedImageScenes:visualAudit.filter(x=>x.animated).length,contactSheet:true},null,2)+"\n");
  console.log("Rendered and passed technical QA: "+output);
}
main().catch(error=>{console.error("Render failed:",error);process.exit(1);});
