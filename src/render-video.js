// Retry transient visual downloads; verified previews remain a safe fallback.
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
    return '<g transform="translate(1220 360)"><rect width="560" height="260" rx="8" fill="#121212" stroke="#C86D2D" stroke-width="2"/><text x="36" y="54" class="visual-label">' + label + '</text><text x="36" y="218" class="visual-detail">' + xml(v.detail || "") + '</text></g>';
  }
  if (v.type === "comparison" && Array.isArray(v.items)) {
    const rows = v.items.slice(0,3).map((item,i) => {
      const y=92+i*72;
      return '<text x="32" y="'+y+'" class="visual-detail">'+xml(item.label)+'</text><rect x="32" y="'+(y+14)+'" width="380" height="16" fill="#292b2d"/><text x="430" y="'+(y+29)+'" class="visual-detail">'+xml(item.value)+'</text>';
    }).join("");
    return '<g transform="translate(1190 330)"><rect width="590" height="330" rx="8" fill="#121212" stroke="#C86D2D" stroke-width="2"/><text x="32" y="52" class="visual-label">'+label+'</text>'+rows+'</g>';
  }
  if (v.type === "timeline" && Array.isArray(v.events)) {
    const events=v.events.slice(0,4).map((item,i) => {
      const x=42+i*132;
      return '<circle cx="'+x+'" cy="150" r="8" fill="#C86D2D"/><text x="'+x+'" y="116" text-anchor="middle" class="visual-label">'+xml(item.date)+'</text><text x="'+x+'" y="184" text-anchor="middle" class="visual-detail">'+xml(item.label)+'</text>';
    }).join("");
    return '<g transform="translate(1060 390)"><rect width="650" height="250" rx="8" fill="#121212" stroke="#C86D2D" stroke-width="2"/><text x="34" y="48" class="visual-label">'+label+'</text><path d="M42 150 H570" stroke="#777" stroke-width="3"/>'+events+'</g>';
  }
  return "";
}

function overlaySvg(scene, index, total) {
  const title = lines((scene.title || "").toUpperCase(), 42).slice(0, 2)
    .map((s,i) => '<text x="120" y="' + (190 + i*76) + '" class="title">' + xml(s) + '</text>').join("");
  const subtitle = scene.subtitle ? '<text x="120" y="340" class="sub">' + xml(scene.subtitle) + '</text>' : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">
  <defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0A0A0B" stop-opacity=".25"/><stop offset=".48" stop-color="#0A0A0B" stop-opacity=".05"/><stop offset="1" stop-color="#0A0A0B" stop-opacity=".92"/></linearGradient></defs>
  <rect width="1920" height="1080" fill="url(#shade)"/>
  <text x="120" y="112" class="eyebrow">THE INVESTIGATION / ${String(index+1).padStart(2,"0")}</text>

  ${title}
  <rect x="120" y="300" width="78" height="5" fill="#C86D2D"/>
  ${subtitle}
  ${visualMarkup(scene)}\n  <text x="1795" y="1010" text-anchor="end" class="page">${String(index+1).padStart(2,"0")} / ${total}</text>
  <style>
  .brand{font:700 34px 'DejaVu Sans';letter-spacing:6px;fill:#FFFFFF}
  .kicker{font:400 17px 'DejaVu Sans';letter-spacing:3px;fill:#C3B7A8}
  .eyebrow{font:700 18px 'DejaVu Sans';letter-spacing:4px;fill:#C86D2D}
  .title{font:700 58px 'DejaVu Sans';letter-spacing:3px;fill:#FFFFFF}
  .sub{font:400 24px 'DejaVu Sans';letter-spacing:0.4px;fill:#E5E5E5}
  .visual-label{font:700 18px DejaVu Sans;letter-spacing:2px;fill:#C86D2D}
  .visual-value{font:700 82px DejaVu Sans;fill:#FFFFFF}
  .visual-detail{font:400 20px DejaVu Sans;fill:#E5E5E5}
  .page{font:400 20px 'DejaVu Sans';fill:#E5E5E5}
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
function srtTimestamp(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const hh = String(Math.floor(ms / 3600000)).padStart(2, "0");
  const mm = String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0");
  const ss = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  return hh + ":" + mm + ":" + ss + "," + String(ms % 1000).padStart(3, "0");
}
function captionLines(sentence, max = 38) {
  const words = String(sentence).trim().split(/\s+/).filter(Boolean);
  const rows = [];
  let line = "";
  for (const word of words) {
    if (line && (line + " " + word).length > max) {
      rows.push(line);
      line = word;
    } else {
      line = line ? line + " " + word : word;
    }
  }
  if (line) rows.push(line);
  return rows;
}
function assTimestamp(seconds) {
  const cs = Math.max(0, Math.round(seconds * 100));
  return String(Math.floor(cs / 360000)) + ":" + String(Math.floor((cs % 360000) / 6000)).padStart(2, "0") + ":" + String(Math.floor((cs % 6000) / 100)).padStart(2, "0") + "." + String(cs % 100).padStart(2, "0");
}
async function writeNarrationSubtitles(narration, duration, output) {
  const words = String(narration).replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const cues = []; let group = []; let rows = []; let line = "";
  for (const word of words) {
    const candidate = line ? line + " " + word : word;
    if (line && candidate.length > 66) { rows.push(line); line = word; } else line = candidate;
    if (rows.length === 2) { cues.push({words:group,text:rows.join("\\N")}); group=[]; rows=[]; }
    group.push(word);
  }
  if (line) rows.push(line);
  if (rows.length) cues.push({words:group,text:rows.join("\\N")});
  const total = words.length || 1; let cursor = 0;
  const events = cues.map((cue,i) => {
    const start = cursor;
    const end = i === cues.length - 1 ? duration : cursor + duration * cue.words.length / total;
    cursor = end;
    return "Dialogue: 0," + assTimestamp(start) + "," + assTimestamp(end) + ",Default,,0,0,0,," + cue.text.replace(/[{}]/g, "");
  });
  const header = ["[Script Info]","ScriptType: v4.00+","PlayResX: 1920","PlayResY: 1080","ScaledBorderAndShadow: yes","WrapStyle: 2","","[V4+ Styles]","Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding","Style: Default,DejaVu Sans,34,&H00FFFFFF,&H000000FF,&H00301A0E,&H990A0A0B,-1,0,1,2.5,1,2,150,150,86,1","","[Events]","Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"];
  await writeFile(output, header.concat(events).join("\n") + "\n");
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
  let lastError;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!response.ok) {
        const error = new Error("Asset download failed (" + response.status + ").");
        if (response.status !== 429 && response.status < 500) throw error;
        lastError = error;
        const retryAfter = Number(response.headers.get("retry-after")) * 1000;
        const delay = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter, 60000) : Math.min(30000, 2000 * (2 ** attempt));
        console.warn(error.message + " Retrying in " + delay + "ms.");
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.toLowerCase().startsWith("image/")) throw new Error("The supplied visual URL did not return an image (content-type: " + contentType + "). Use a direct HTTPS image URL, not a webpage URL.");
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 4096 || bytes.length > 25 * 1024 * 1024) throw new Error("The supplied image has an invalid file size.");
      await writeFile(dest, bytes);
      return;
    } catch (error) {
      lastError = error;
      if (attempt === 5 || !/fetch failed|timeout|network|Asset download failed \((429|5\d\d)\)/i.test(error.message)) throw error;
      const delay = Math.min(30000, 2000 * (2 ** attempt));
      console.warn("Visual download temporarily unavailable; retrying in " + delay + "ms: " + error.message);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError || new Error("Visual asset download failed after retries.");
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
  const downloadedAssetFiles = new Map();
  const contactSheetItems = [];
  for (let i=0; i<script.scenes.length; i++) {
    const scene = script.scenes[i];
    if (!scene.narration?.trim()) throw new Error("Scene " + (i+1) + " has no narration.");
    const stem = "scene-" + String(i+1).padStart(2,"0");
    const audio = path.join(OUT, stem + ".wav");
    const svg = path.join(OUT, stem + ".svg");
    const subtitles = path.join(OUT, stem + ".ass");
    const rendered = path.join(OUT, stem + ".mp4");
    await piperTTS(scene.narration, audio);
    const audioDuration = await probeDuration(audio);
    await writeNarrationSubtitles(scene.narration, audioDuration, subtitles);
    await writeFile(svg, overlaySvg(scene, i, script.scenes.length));
    const selected = selection.scenes.find(item => item.scene === i+1)?.selectedImageIds || [];
    if (!selected.length) throw new Error("Scene " + (i+1) + " has no approved visual selections.");
    const renderIds = [...selected];
    if (new Set(renderIds).size !== renderIds.length) throw new Error("Scene " + (i+1) + " repeats a selected image ID.");
    const sceneAssets = renderIds.map(id => assetById.get(id));
    if (sceneAssets.some(asset => !asset || asset.scene !== i+1 || Number(asset.relevanceScore || 0) < 3)) {
      throw new Error("Scene " + (i+1) + " contains a missing, misassigned, or low-relevance visual asset.");
    }
    const imageFiles = [];
    for (const id of renderIds) {
      const asset = assetById.get(id);
      if (!asset || asset.scene !== i+1) throw new Error("Selected image " + id + " is missing or assigned to the wrong scene.");
      const assetKey = asset.directUrl || asset.sourcePage;
      const previewFile = path.join(OUT, asset.previewFile || (id + ".jpg"));
      const renderFile = path.join(OUT, asset.largeImageURL ? (id + "-full.jpg") : (id + ".jpg"));
      let imageFile = downloadedAssetFiles.get(assetKey);
      if (!imageFile) {
        imageFile = renderFile;
        if (!await stat(imageFile).then(()=>true).catch(()=>false)) {
          const imageUrl = asset.directUrl || asset.largeImageURL || await pixabayImageUrl(asset.sourcePage);
          try {
            await download(imageUrl, imageFile);
          } catch (error) {
            if (asset.previewFile && await stat(previewFile).then(() => true).catch(() => false)) {
              console.warn("Full-resolution visual unavailable for " + id + "; using the already verified downloaded preview instead. " + error.message);
              await writeFile(imageFile, await readFile(previewFile));
            } else {
              throw error;
            }
          }
        }
        downloadedAssetFiles.set(assetKey, imageFile);
        contactSheetItems.push({ id, scene: asset.scene, file: previewFile });
      }
      imageFiles.push(imageFile);
      credits.push({ scene:i+1, sourceScene:asset.scene, imageId:id, provider:asset.provider || "Pixabay", page:asset.sourcePage, creator:asset.creator,
        tags:asset.tags, license:asset.license, licenseUrl:asset.licenseUrl, illustrative:true });
    }
    const transition = imageFiles.length > 1 ? 0.42 : 0;
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
      const offset = Math.max(0, n * (segmentDuration - transition));
      filters.push("["+baseLabel+"][v"+n+"]xfade=transition=fade:duration="+transition+":offset="+offset.toFixed(3)+"["+nextLabel+"]");
      baseLabel = nextLabel;
    }
    filters.push("["+baseLabel+"]["+svgIndex+":v]overlay=0:0:shortest=1[withsvgbase]");
    const subtitlePath = subtitles.replace(/\\\\/g, "/").replace(/:/g, "\\\\:");
    filters.push("[withsvgbase]subtitles=filename=" + subtitlePath + ",format=yuv420p[withsvg]");
    let finalVideoLabel = "withsvg";
    if (scene.visual?.type === "comparison" && Array.isArray(scene.visual.items)) {
      scene.visual.items.slice(0,3).forEach((item,idx) => {
        const y = 436 + idx*72;
        const width = Math.max(1,Math.min(100,Number(item.percent)||0))*3.8;
        const next = "bar"+idx;
        filters.push("["+finalVideoLabel+"]drawbox=x=1222:y="+y+":w='max(1,"+width.toFixed(1)+"*min(t/1.25,1))':h=16:color=0xA8794D:t=fill["+next+"]");
        finalVideoLabel = next;
      });
    }
    if (scene.visual?.type === "metric" && scene.visual.value) {
      filters.push("["+finalVideoLabel+"]drawtext=text='"+String(scene.visual.value).replace(/'/g,"\\\\'")+"':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:fontsize=78:fontcolor=white:x=1256:y=440:alpha='if(lt(t,0.7),t/0.7,if(lt(t,3.2),1,0))':enable='between(t,0,3.5)'[metric]");
      finalVideoLabel = "metric";
    }
    const keywords = (scene.keywords || []).slice(0,4).join("  •  ").replace(/:/g,"\\\\:");
    if (keywords) {
      filters.push("["+finalVideoLabel+"]drawtext=text='"+keywords.replace(/'/g,"\\\\'")+"':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:fontsize=27:fontcolor=0xD97724:x=(w-text_w)/2:y=610:alpha='if(lt(t,0.45),t/0.45,if(lt(t,4.0),1,0))':enable='between(t,0,4.2)'[keyterms]");
      finalVideoLabel = "keyterms";
    }
    if (i===0) {
      filters.push("["+finalVideoLabel+"]drawtext=text='THE HIDDEN ENGINE':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:fontsize=40:fontcolor=white:box=1:boxcolor=black@0.72:boxborderw=24:x=(w-text_w)/2:y=(h-text_h)/2:alpha='if(lt(t,0.25),t/0.25,if(lt(t,17),1,if(lt(t,17.5),(17.5-t)/0.5,0)))':enable='between(t,15,17.5)'[logo]");
      finalVideoLabel = "logo";
    }
    filters.push("["+finalVideoLabel+"]format=yuv420p[v]");
    args.push("-filter_complex",filters.join(";"),"-map","[v]","-map",audioIndex+":a",
      "-c:v","libx264","-preset","veryfast","-crf","20","-c:a","aac","-b:a","192k",
      "-t",audioDuration.toFixed(3),"-shortest","-movflags","+faststart",rendered);
    await run("ffmpeg",args);
    visualAudit.push({scene:i+1,selectedImageIds:renderIds,renderedImages:imageFiles.length,animated:true,
      targetShotDurationSeconds:5,actualAverageShotDurationSeconds:Number((audioDuration/imageFiles.length).toFixed(2)),
      narrationMatchedShots:selection.scenes.find(item=>item.scene===i+1)?.shots||[],
      sourceTags:selected.map(id=>assetById.get(id).tags)});
    clips.push(rendered);
    console.log("Rendered scene "+(i+1)+"/"+script.scenes.length+" with "+imageFiles.length+" fast-cut stills, 0.42s crossfades and 5-10% Ken Burns motion.");
  }
  // Build the required review contact sheet from every distinct source image.
  const cols = 5, cellW = 320, cellH = 180, labelH = 36, gap = 10, margin = 10;
  const rows = Math.ceil(contactSheetItems.length / cols);
  const sheetParts = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + (margin*2+cols*cellW+(cols-1)*gap) + '" height="' + (margin*2+rows*(cellH+labelH)+(rows-1)*gap) + '">', '<rect width="100%" height="100%" fill="#0A0A0B"/>'];
  for (let n = 0; n < contactSheetItems.length; n++) {
    const item = contactSheetItems[n], x = margin + (n % cols) * (cellW + gap), y = margin + Math.floor(n / cols) * (cellH + labelH + gap);
    const data = (await readFile(item.file)).toString("base64");
    sheetParts.push('<rect x="' + x + '" y="' + y + '" width="' + cellW + '" height="' + (cellH + labelH) + '" fill="#1A1A1C"/>');
    sheetParts.push('<image x="' + x + '" y="' + y + '" width="' + cellW + '" height="' + cellH + '" preserveAspectRatio="xMidYMid slice" href="data:image/jpeg;base64,' + data + '"/>');
    sheetParts.push('<text x="' + (x + 10) + '" y="' + (y + cellH + 24) + '" fill="#f0ede5" font-family="DejaVu Sans" font-size="14">' + xml(item.id + " • SCENE " + item.scene) + '</text>');
  }
  sheetParts.push("</svg>");
  const contactSvg = path.join(OUT, "contact-sheet.svg");
  await writeFile(contactSvg, sheetParts.join(""));
  await run("rsvg-convert", ["-f", "png", "-o", path.join(OUT, "contact-sheet.png"), contactSvg]);
  await run("ffmpeg", ["-y", "-i", path.join(OUT, "contact-sheet.png"), "-frames:v", "1", "-q:v", "2", path.join(OUT, "contact-sheet.jpg")]);

  // Join complete scenes with real video and narration crossfades. The
  // previous concat-demuxer/-c copy path cut both picture and dialogue abruptly.
  const output = path.join(OUT,"the-hidden-engine-documentary.mp4");
  const sceneDurations = await Promise.all(clips.map(probeDuration));
  if (sceneDurations.some(duration => !Number.isFinite(duration) || duration <= 0.8)) {
    throw new Error("Scene transition QA failed: every rendered scene must exceed 0.8 seconds.");
  }
  const videoFade = Math.min(0.65, Math.min(...sceneDurations) * 0.15);
  const audioFade = Math.min(0.45, Math.min(...sceneDurations) * 0.10);
  const transitionInputs = clips.flatMap(file => ["-i", file]);
  const transitionFilters = [];
  for (let n = 0; n < clips.length; n++) {
    transitionFilters.push("[" + n + ":v]settb=AVTB,setpts=PTS-STARTPTS,fps=25,format=yuv420p[vscene" + n + "]");
    transitionFilters.push("[" + n + ":a]aresample=44100,asetpts=PTS-STARTPTS[ascene" + n + "]");
  }
  let videoLabel = "vscene0";
  let audioLabel = "ascene0";
  let elapsedVideo = sceneDurations[0];
  for (let n = 1; n < clips.length; n++) {
    const nextVideo = "vtransition" + n;
    const nextAudio = "atransition" + n;
    const offset = Math.max(0, elapsedVideo - videoFade);
    transitionFilters.push("[" + videoLabel + "][vscene" + n + "]xfade=transition=fade:duration=" + videoFade.toFixed(3) + ":offset=" + offset.toFixed(3) + "[" + nextVideo + "]");
    transitionFilters.push("[" + audioLabel + "][ascene" + n + "]acrossfade=d=" + audioFade.toFixed(3) + ":c1=tri:c2=tri[" + nextAudio + "]");
    videoLabel = nextVideo;
    audioLabel = nextAudio;
    elapsedVideo += sceneDurations[n] - videoFade;
  }
  const finalTransitionVideo = "vtransition-final";
  const finalTransitionAudio = "atransition-final";
  transitionFilters.push("[" + videoLabel + "]format=yuv420p[" + finalTransitionVideo + "]");
  transitionFilters.push("[" + audioLabel + "]anull[" + finalTransitionAudio + "]");
  await run("ffmpeg",[
    "-y",...transitionInputs,
    "-filter_complex",transitionFilters.join(";"),
    "-map","[" + finalTransitionVideo + "]","-map","[" + finalTransitionAudio + "]",
    "-c:v","libx264","-preset","veryfast","-crf","20",
    "-c:a","aac","-b:a","192k","-movflags","+faststart",output
  ]);
  const rawProbe = await capture("ffprobe", ["-v","error","-show_entries","format=duration","-of","default=noprint_wrappers=1:nokey=1",output]);
  const rawDuration = Number(rawProbe.stdout.trim());
  const whoosh = path.join(OUT,"transition-whoosh.wav");
  const click = path.join(OUT,"number-click.wav");
  await run("ffmpeg",["-y","-f","lavfi","-i","anoisesrc=color=pink:sample_rate=22050:duration="+rawDuration,
    "-af","highpass=f=320,lowpass=f=1500,volume='if(lt(mod(t,14),0.20),0.032,0)',afade=t=in:st=0:d=1,afade=t=out:st="+Math.max(0,rawDuration-2)+":d=2",whoosh]);
  await run("ffmpeg",["-y","-f","lavfi","-i","sine=frequency=1650:sample_rate=22050:duration="+rawDuration,
    "-af","volume='if(lt(mod(t,48),0.06),0.012,0)',afade=t=in:st=0:d=0.1",click]);
  const ambient = path.join(OUT,"original-ambient-bed.wav");
  await run("ffmpeg",["-y","-f","lavfi","-i","aevalsrc=0.075*sin(2*PI*110*t)+0.055*sin(2*PI*164.81*t)+0.035*sin(2*PI*220*t)+0.018*sin(2*PI*329.63*t):s=44100:d="+rawDuration,
    "-f","lavfi","-i","anoisesrc=color=pink:amplitude=0.018:sample_rate=44100:duration="+rawDuration,
    "-filter_complex","[0:a]lowpass=f=900,volume=0.42[tone];[1:a]highpass=f=180,lowpass=f=1400,volume=0.20[air];[tone][air]amix=inputs=2:duration=longest,afade=t=in:st=0:d=5,afade=t=out:st="+Math.max(0,rawDuration-7)+":d=7[out]",
    "-map","[out]",ambient]);
  const mixed = path.join(OUT,"mixed-final.mp4");
  await run("ffmpeg",["-y","-i",output,"-i",whoosh,"-i",click,"-i",ambient,
    "-filter_complex","[0:a]volume=1[voice];[1:a]volume=0.55[whoosh];[2:a]volume=0.45[click];[3:a]volume=0.18[bed];[voice][whoosh][click][bed]amix=inputs=4:duration=first:dropout_transition=3,loudnorm=I=-14:TP=-1.5:LRA=7[a]",
    "-map","0:v","-map","[a]","-c:v","copy","-c:a","aac","-b:a","192k","-movflags","+faststart",mixed]);
  await run("ffmpeg",["-y","-i",mixed,"-c","copy",output+".tmp.mp4"]);
  await writeFile(path.join(OUT,"visual-credits.json"),JSON.stringify(credits,null,2)+"\n");
  await (await import("node:fs/promises")).rename(output+".tmp.mp4",output);
  const uniqueImageCount=new Set(credits.map(item=>item.imageId)).size;
  if(uniqueImageCount!==credits.length) throw new Error("Visual QA failed: repeated source image IDs across scenes ("+uniqueImageCount+"/"+credits.length+").");
  if(visualAudit.some(item=>new Set(item.selectedImageIds).size!==item.selectedImageIds.length||item.renderedImages<6)) throw new Error("Visual QA failed: every scene requires at least six distinct, narration-matched images.");
  await writeFile(path.join(OUT,"VISUAL-AUDIT.json"),JSON.stringify(visualAudit,null,2)+"\n");
  await writeFile(path.join(OUT,"CREDITS.md"),[
    "# Research sources","",
    ...(script.sources || []).map(source=>"- **"+source.name+"** — "+source.supports+" "+source.url),
    "",
    "# Visual credits","",
    "Visuals were curated for this documentary from the linked source pages. Review the applicable license and credit requirements before publication.",
    "All selected stills are illustrative stock imagery, not evidence of a specific company, person, product, or event unless independently verified.",
    "",
    ...script.scenes.filter(scene=>scene.visual?.source_url).map(scene=>"- Scene "+(script.scenes.indexOf(scene)+1)+" data graphic: "+(scene.visual.source_label||"Source")+": "+scene.visual.source_url),
    ...credits.map(c=>"imageId" in c
      ? "- Scene "+c.scene+" ("+c.imageId+"): [Pixabay image]("+c.page+") — "+c.creator+"; illustrative stock image. License: [Pixabay Content License]("+c.licenseUrl+")"
      : "- Scene "+c.scene+": "+c.provider+" — "+c.note)
  ].join("\n")+"\n");
  await writeFile(path.join(OUT,"README.txt"),[
    "The Hidden Engine documentary render",
    "Narration: Local Piper neural TTS (no paid API quota required).",
    "Visuals: unique narration-matched still images selected with query and scene-requirement relevance gates, with animated camera movement, crossfades, and original data overlays.",
    "Identity: near-black and charcoal, white/ivory typography, copper #C86D2D accents, restrained documentary-investigative overlays.",
    "Review all claims, pronunciations, visual relevance, licenses, and credits before publication.",
    "Audio: original low-level synthesized ambient underscore with restrained transition accents. No automatic YouTube upload."
  ].join("\n")+"\n");
  const qa = await new Promise((resolve,reject) => { const p=spawn("ffprobe",["-v","error","-show_entries","format=duration:stream=codec_type,width,height","-of","json",output]); let data=""; p.stdout.on("data",d=>data+=d); p.on("error",reject); p.on("close",code=>code===0?resolve(JSON.parse(data)):reject(new Error("ffprobe failed"))); });
  const finalDuration = Number(qa.format.duration);
  if (!qa.streams.some(x=>x.codec_type==="video" && x.width===1920 && x.height===1080) || !qa.streams.some(x=>x.codec_type==="audio")) throw new Error("Final MP4 failed audio/1080p QA.");
  if (finalDuration < 13*60 || finalDuration > 18*60) throw new Error("Final runtime "+finalDuration.toFixed(1)+"s is outside the 13–18 minute documentary target.");
  if (visualAudit.some(x=>x.renderedImages < 1 || x.actualAverageShotDurationSeconds > 6.5)) throw new Error("Visual pacing QA failed: every scene needs distinct narration-matched shots averaging no more than 6.5 seconds.");
  await access(path.join(OUT,"contact-sheet.jpg")).catch(()=>{throw new Error("Final contact-sheet.jpg is missing.");});
  await writeFile(path.join(OUT,"QA-REPORT.json"),JSON.stringify({file:path.basename(output),width:1920,height:1080,duration:finalDuration,targetDurationMinutes:15,acceptedDurationRangeMinutes:[13,18],audio:true,scenes:clips.length,selectedImages:credits.length,uniqueImages:uniqueImageCount,uniqueImageRatio:Number((uniqueImageCount/Math.max(1,credits.length)).toFixed(3)),imagesPerScene:Math.min(...visualAudit.map(x=>x.renderedImages)),visualRelevanceGate:true,visualChangeTargetSeconds:5,animatedImageScenes:visualAudit.filter(x=>x.animated).length,originalMusic:true,ambientMusicBed:true,musicTargetDb:-28,transitionWhooshes:true,numberClicks:true,sceneVideoCrossfadeSeconds:Number(videoFade.toFixed(3)),sceneAudioCrossfadeSeconds:Number(audioFade.toFixed(3)),sceneTransitions:Math.max(0,clips.length-1),contactSheet:true},null,2)+"\n");
  console.log("Rendered and passed technical QA: "+output);
}
main().catch(error=>{console.error("Render failed:",error);process.exit(1);});
