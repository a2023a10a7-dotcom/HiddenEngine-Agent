import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const PROJECT_ID = process.env.PROJECT_ID;
if (!PROJECT_ID || !/^[a-z0-9-]+$/.test(PROJECT_ID)) throw new Error("PROJECT_ID is missing or invalid.");
const ROOT = path.join("production", "projects", PROJECT_ID);
const OUT = path.join("dist", PROJECT_ID);
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID;
const PEXELS_API_KEY = process.env.PEXELS_API_KEY;

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
\nfunction overlaySvg(scene, index, total) {
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
  .visual-label{font:700 18px DejaVu Sans;letter-spacing:2px;fill:#C08A58}\n  .visual-value{font:700 82px DejaVu Sans;fill:#F0EDE5}\n  .visual-detail{font:400 20px DejaVu Sans;fill:#D5D1C8}\n  .page{font:400 20px 'DejaVu Sans';fill:#D5D1C8}
  </style></svg>`;
}
async function elevenLabs(text, output) {
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
async function download(url, dest) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Asset download failed (" + response.status + ").");
  await writeFile(dest, Buffer.from(await response.arrayBuffer()));
}
async function main() {
  if (!ELEVENLABS_API_KEY || !ELEVENLABS_VOICE_ID) {
    throw new Error("Natural narration requires ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in GitHub Actions Secrets/Variables. No robotic fallback voice will be generated.");
  }
  const script = JSON.parse(await readFile(path.join(ROOT, "script.json"), "utf8"));
  if (!Array.isArray(script.scenes) || !script.scenes.length) throw new Error("script.json has no scenes.");
  await mkdir(OUT, { recursive: true });
  const clips = [], credits = [];
  for (let i=0; i<script.scenes.length; i++) {
    const scene = script.scenes[i];
    if (!scene.narration?.trim()) throw new Error("Scene " + (i+1) + " has no narration.");
    const stem = "scene-" + String(i+1).padStart(2,"0");
    const audio = path.join(OUT, stem + ".mp3");
    const svg = path.join(OUT, stem + ".svg");
    const clip = path.join(OUT, stem + "-visual.mp4");
    const rendered = path.join(OUT, stem + ".mp4");
    await elevenLabs(scene.narration, audio);
    await writeFile(svg, overlaySvg(scene, i, script.scenes.length));
    const query = scene.visual_query || [scene.title, scene.subtitle].filter(Boolean).join(" ");
    const asset = await findPexelsVideo(query);
    if (asset) {
      await download(asset.url, clip);
      credits.push({ scene: i+1, query, provider:"Pexels", page:asset.page, creator:asset.creator, creatorUrl:asset.creatorUrl });
      await run("ffmpeg", ["-y","-stream_loop","-1","-i",clip,"-i",audio,"-loop","1","-i",svg,
        "-filter_complex","[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,eq=contrast=1.12:saturation=0.78,drawbox=x=0:y=0:w=iw:h=ih:color=#08090b@0.18:t=fill[bg];[bg][2:v]overlay=0:0,format=yuv420p[v]",
        "-map","[v]","-map","1:a","-c:v","libx264","-preset","veryfast","-crf","21","-c:a","aac","-b:a","192k","-shortest","-movflags","+faststart",rendered]);
    } else {
      credits.push({ scene:i+1, query, provider:"Original motion graphic", note:"No matching Pexels video was returned; generated a branded animated graphic instead." });
      await run("ffmpeg", ["-y","-f","lavfi","-i","color=c=#101113:s=1920x1080:r=25","-i",audio,"-loop","1","-i",svg,
        "-filter_complex","[0:v]zoompan=z='min(zoom+0.00035,1.08)':d=125:s=1920x1080:fps=25,format=yuv420p[bg];[bg][2:v]overlay=0:0,format=yuv420p[v]",
        "-map","[v]","-map","1:a","-c:v","libx264","-preset","veryfast","-crf","21","-c:a","aac","-b:a","192k","-shortest","-movflags","+faststart",rendered]);
    }
    clips.push(rendered);
    console.log("Rendered scene " + (i+1) + "/" + script.scenes.length + (asset ? " with licensed stock footage." : " with branded motion graphics."));
  }
  const list = path.join(OUT,"concat.txt");
  await writeFile(list, clips.map(f=>"file '"+path.basename(f)+"'").join("\n")+"\n");
  const output = path.join(OUT,"the-hidden-engine-documentary.mp4");
  await run("ffmpeg",["-y","-f","concat","-safe","0","-i",list,"-c","copy","-movflags","+faststart",output]);
  await writeFile(path.join(OUT,"visual-credits.json"),JSON.stringify(credits,null,2)+"\n");
  await writeFile(path.join(OUT,"CREDITS.md"),[
    "# Visual credits","",
    "Stock footage is sourced from Pexels. Review the linked asset page and applicable license before publication.",
    "Pexels footage is used as illustrative material and must not be presented as actual footage of a specific company, person, product, or event unless independently verified.",
    "",
    ...credits.map(c=>c.provider==="Pexels"
      ? "- Scene "+c.scene+": [Pexels video]("+c.page+") — "+c.creator+(c.creatorUrl?" ([creator]("+c.creatorUrl+"))":"")
      : "- Scene "+c.scene+": "+c.provider+" — "+c.note)
  ].join("\n")+"\n");
  await writeFile(path.join(OUT,"README.txt"),[
    "The Hidden Engine documentary render",
    "Narration: ElevenLabs API (natural AI voice; selected voice configured by repository secret/variable).",
    "Visuals: Pexels stock footage where relevant; otherwise original branded motion graphics.",
    "Identity: charcoal/black, ivory typography, restrained copper accents, documentary-investigative overlays.",
    "Review all claims, pronunciations, visual relevance, licenses, and credits before publication.",
    "No automatic YouTube upload."
  ].join("\n")+"\n");
  const qa = await new Promise((resolve,reject) => { const p=spawn("ffprobe",["-v","error","-show_entries","format=duration:stream=codec_type,width,height","-of","json",output]); let data=""; p.stdout.on("data",d=>data+=d); p.on("error",reject); p.on("close",code=>code===0?resolve(JSON.parse(data)):reject(new Error("ffprobe failed"))); });
  if (!qa.streams.some(x=>x.codec_type==="video" && x.width===1920 && x.height===1080) || !qa.streams.some(x=>x.codec_type==="audio")) throw new Error("Final MP4 failed audio/1080p QA.");
  await writeFile(path.join(OUT,"QA-REPORT.json"),JSON.stringify({file:path.basename(output),width:1920,height:1080,duration:Number(qa.format.duration),audio:true,scenes:clips.length},null,2)+"\n");
  console.log("Rendered and passed technical QA: "+output);
}
main().catch(error=>{console.error("Render failed:",error);process.exit(1);});
