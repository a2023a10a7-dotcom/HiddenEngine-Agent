import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const PROJECT_ID = process.env.PROJECT_ID;
if (!PROJECT_ID || !/^[a-z0-9-]+$/.test(PROJECT_ID)) throw new Error("PROJECT_ID is missing or invalid.");
const ROOT = path.join("production", "projects", PROJECT_ID);
const OUT = path.join("dist", PROJECT_ID);
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID;

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error(command + " exited with code " + code)));
  });
}

function capture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => stdout += chunk);
    child.stderr.on("data", chunk => stderr += chunk);
    child.on("error", reject);
    child.on("close", code => code === 0
      ? resolve({ stdout, stderr })
      : reject(new Error(stderr || command + " exited with code " + code)));
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
    .map((s,i) => '<text x="120" y="' + (650 + i*70) + '" class="title">' + xml(s) + '</text>').join("");
  const subtitle = lines(scene.subtitle || "", 58).slice(0, 2)
    .map((s,i) => '<text x="124" y="' + (790 + i*34) + '" class="sub">' + xml(s) + '</text>').join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">
  <defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#08090b" stop-opacity=".25"/><stop offset=".48" stop-color="#08090b" stop-opacity=".05"/><stop offset="1" stop-color="#08090b" stop-opacity=".92"/></linearGradient></defs>
  <rect width="1920" height="1080" fill="url(#shade)"/>
  <rect x="120" y="112" width="7" height="68" fill="#A8794D"/>
  <text x="154" y="145" class="brand">THE HIDDEN ENGINE</text>
  <text x="154" y="180" class="kicker">BUSINESS • STRATEGY • THE HIDDEN ECONOMICS</text>
  <text x="120" y="590" class="eyebrow">THE INVESTIGATION</text>
  ${title}${subtitle}
  ${visualMarkup(scene)}\n
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
async function probeAudioDuration(file) {
  const result = await capture("ffprobe", [
    "-v", "error", "-select_streams", "a:0",
    "-show_entries", "stream=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", file
  ]);
  const duration = Number(result.stdout.trim().split(/\s+/)[0]);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Could not verify generated narration duration with FFprobe.");
  }
  return duration;
}
async function detectSilence(file, duration) {
  const result = await capture("ffmpeg", [
    "-hide_banner", "-i", file,
    "-af", "silencedetect=noise=-35dB:d=0.20",
    "-f", "null", "-"
  ]);
  const intervals = [];
  const starts = [];
  const pattern = /silence_(start|end):\s*([0-9.]+)/g;
  for (const match of result.stderr.matchAll(pattern)) {
    const time = Number(match[2]);
    if (match[1] === "start") {
      starts.push(time);
    } else if (starts.length) {
      const start = starts.shift();
      if (time > start) intervals.push({ startSeconds: start, endSeconds: time, durationSeconds: Number((time - start).toFixed(3)) });
    }
  }
  for (const start of starts) {
    if (duration > start) intervals.push({
      startSeconds: start,
      endSeconds: duration,
      durationSeconds: Number((duration - start).toFixed(3))
    });
  }
  return intervals;
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
  const scriptPath = path.join(ROOT, "script.json");
  const planPath = path.join(ROOT, "VISUAL-PLAN.json");
  const script = JSON.parse(await readFile(scriptPath, "utf8"));
  const visualPlan = JSON.parse(await readFile(planPath, "utf8"));
  if (!Array.isArray(script.scenes) || !script.scenes.length) throw new Error("script.json has no shots.");
  if (visualPlan.projectId !== PROJECT_ID || visualPlan.status !== "awaiting_visual_research_and_review") {
    throw new Error("VISUAL-PLAN.json is not valid for this project.");
  }
  const plannedShots = new Map(visualPlan.scenes.flatMap(scene => scene.shots.map(shot => [shot.shotId, shot])));
  if (plannedShots.size !== script.scenes.length) throw new Error("Render script shot count differs from VISUAL-PLAN.json.");
  await mkdir(OUT, { recursive: true });
  const clips = [], credits = [], sceneDurations = [];
  for (let i=0; i<script.scenes.length; i++) {
    const scene = script.scenes[i];
    if (!scene.narration?.trim()) throw new Error("Scene " + (i+1) + " has no narration.");
    const stem = "scene-" + String(i+1).padStart(2,"0");
    const audio = path.join(OUT, stem + ".mp3");
    const svg = path.join(OUT, stem + ".svg");
    const clip = path.join(OUT, stem + "-visual.mp4");
    const rendered = path.join(OUT, stem + ".mp4");
    await elevenLabs(scene.narration, audio);
    const actualNarrationSeconds = await probeAudioDuration(audio);
    if (actualNarrationSeconds > 12) {
      throw new Error("Shot " + (scene.shotId || i+1) + " narration is " + actualNarrationSeconds.toFixed(2) + " seconds; maximum allowed is 12 seconds.");
    }
    const silenceIntervals = await detectSilence(audio, actualNarrationSeconds);
    const plannedShot = plannedShots.get(scene.shotId);
    if (!plannedShot) throw new Error("Shot " + scene.shotId + " is missing from VISUAL-PLAN.json.");
    plannedShot.measuredDurationSeconds = Number(actualNarrationSeconds.toFixed(3));
    plannedShot.silenceIntervals = silenceIntervals;
    scene.measuredDurationSeconds = Number(actualNarrationSeconds.toFixed(3));
    sceneDurations.push(actualNarrationSeconds);
    await writeFile(svg, overlaySvg(scene, i, script.scenes.length));
    const visualAsset = scene.visualAsset || null;
    if (visualAsset) {
      const assetPath = path.resolve(ROOT, visualAsset.filePath || "");
      if (!assetPath.startsWith(path.resolve(ROOT) + path.sep)) throw new Error("Scene " + (i+1) + " visual asset path escapes project folder.");
      const assetStat = await (await import("node:fs/promises")).stat(assetPath);
      if (!assetStat.isFile() || assetStat.size === 0) throw new Error("Scene " + (i+1) + " visual asset is missing or empty.");
      if (visualAsset.mediaType === "image") {
        credits.push({scene:i+1,assetId:visualAsset.id,mediaType:"image",sourceUrl:visualAsset.sourceUrl,creator:visualAsset.creator,license:visualAsset.license,attribution:visualAsset.attribution});
        await run("ffmpeg", ["-y","-loop","1","-framerate","25","-i",assetPath,"-i",audio,"-loop","1","-i",svg,
          "-filter_complex","[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,zoompan=z='min(zoom+0.0002,1.05)':d=1:s=1920x1080:fps=25,format=yuv420p[bg];[bg][2:v]overlay=0:0,format=yuv420p[v]",
          "-map","[v]","-map","1:a","-c:v","libx264","-preset","veryfast","-crf","21","-c:a","aac","-b:a","192k","-shortest","-movflags","+faststart",rendered]);
      } else if (visualAsset.mediaType === "video") {
        credits.push({scene:i+1,assetId:visualAsset.id,mediaType:"video",sourceUrl:visualAsset.sourceUrl,creator:visualAsset.creator,license:visualAsset.license,attribution:visualAsset.attribution});
        await run("ffmpeg", ["-y","-stream_loop","-1","-i",assetPath,"-i",audio,"-loop","1","-i",svg,
          "-filter_complex","[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080[bg];[bg][2:v]overlay=0:0,format=yuv420p[v]",
          "-map","[v]","-map","1:a","-c:v","libx264","-preset","veryfast","-crf","21","-c:a","aac","-b:a","192k","-shortest","-movflags","+faststart",rendered]);
      } else {
        throw new Error("Scene " + (i+1) + " has unsupported visual asset type.");
      }
    } else {
      credits.push({scene:i+1,provider:"Original motion graphic",note:"No approved scene asset was supplied; generated a branded motion graphic instead."});
      await run("ffmpeg", ["-y","-f","lavfi","-i","color=c=#101113:s=1920x1080:r=25","-i",audio,"-loop","1","-i",svg,
        "-filter_complex","[0:v]zoompan=z='min(zoom+0.0002,1.03)':d=1:s=1920x1080:fps=25,format=yuv420p[bg];[bg][2:v]overlay=0:0,format=yuv420p[v]",
        "-map","[v]","-map","1:a","-c:v","libx264","-preset","veryfast","-crf","21","-c:a","aac","-b:a","192k","-shortest","-movflags","+faststart",rendered]);
    }
    clips.push(rendered);
    console.log("Rendered scene " + (i+1) + "/" + script.scenes.length + (visualAsset ? " with approved visual asset." : " with branded motion graphics."));
  }
  const list = path.join(OUT,"concat.txt");
  await writeFile(list, clips.map(f=>"file '"+path.basename(f)+"'").join("\n")+"\n");
  const output = path.join(OUT,"the-hidden-engine-documentary.mp4");
  await run("ffmpeg",["-y","-f","concat","-safe","0","-i",list,"-c","copy","-movflags","+faststart",output]);
  await writeFile(path.join(OUT,"visual-credits.json"),JSON.stringify(credits,null,2)+"\n");
  await writeFile(path.join(OUT,"CREDITS.md"),[
    "# Visual credits","",
    "Visual assets are supplied through the project approved-assets manifest. Review the source, license evidence, and attribution for every asset before publication.",
    "Pexels footage is used as illustrative material and must not be presented as actual footage of a specific company, person, product, or event unless independently verified.",
    "",
    ...credits.map(c=>c.assetId
      ? "- Scene "+c.scene+": "+c.mediaType+" asset "+c.assetId+" — "+c.creator+"; "+c.license+"; "+c.sourceUrl+"; attribution: "+c.attribution
      : "- Scene "+c.scene+": "+c.provider+" — "+c.note)
  ].join("\n")+"\n");
  await writeFile(path.join(OUT,"README.txt"),[
    "The Hidden Engine documentary render",
    "Narration: ElevenLabs API (natural AI voice; selected voice configured by repository secret/variable).",
    "Visuals: rights-cleared, scene-assigned image/video assets where supplied; otherwise original branded motion graphics.",
    "Identity: charcoal/black, ivory typography, restrained copper accents, documentary-investigative overlays.",
    "Review all claims, pronunciations, visual relevance, licenses, and credits before publication.",
    "No automatic YouTube upload."
  ].join("\n")+"\n");
  const qaResult = await capture("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration:stream=codec_type,width,height,duration",
    "-of", "json", output
  ]);
  const qa = JSON.parse(qaResult.stdout);
  const audioStream = qa.streams.find(stream => stream.codec_type === "audio");
  if (!qa.streams.some(stream => stream.codec_type === "video" && stream.width === 1920 && stream.height === 1080) || !audioStream) {
    throw new Error("Final MP4 failed audio/1080p QA.");
  }
  const measuredShotsTotal = sceneDurations.reduce((sum, value) => sum + value, 0);
  const finalAudioDuration = Number(audioStream.duration || qa.format.duration);
  const durationDifference = Math.abs(measuredShotsTotal - finalAudioDuration);
  if (!Number.isFinite(finalAudioDuration) || durationDifference > 0.5) {
    throw new Error("Audio duration gate failed: summed shot audio " + measuredShotsTotal.toFixed(3) +
      "s differs from final audio " + finalAudioDuration.toFixed(3) + "s by " +
      durationDifference.toFixed(3) + "s (maximum 0.5s).");
  }
  await writeFile(planPath, JSON.stringify(visualPlan, null, 2) + "\n");
  await writeFile(scriptPath, JSON.stringify(script, null, 2) + "\n");
  const averageSceneSeconds = sceneDurations.reduce((sum,value)=>sum+value,0)/sceneDurations.length;
  await writeFile(path.join(OUT,"QA-REPORT.json"),JSON.stringify({
    file:path.basename(output),width:1920,height:1080,duration:Number(qa.format.duration),
    audio:true,scenes:clips.length,
    summedMeasuredShotAudioSeconds:Number(measuredShotsTotal.toFixed(3)),
    finalAudioDurationSeconds:Number(finalAudioDuration.toFixed(3)),
    audioDurationDifferenceSeconds:Number(durationDifference.toFixed(3)),
    silenceIntervalsDetected:visualPlan.scenes.reduce((sum, scene) => sum + scene.shots.reduce((count, shot) => count + (shot.silenceIntervals || []).length, 0), 0),
    averageSceneSeconds:Number(averageSceneSeconds.toFixed(2)),
    longestSceneSeconds:Number(Math.max(...sceneDurations).toFixed(2)),
    sceneDurationsSeconds:sceneDurations.map(value=>Number(value.toFixed(2)))
  },null,2)+"\n");
  console.log("Rendered and passed technical QA: "+output+" ("+clips.length+" scenes; average "+averageSceneSeconds.toFixed(2)+"s; longest "+Math.max(...sceneDurations).toFixed(2)+"s).");
}
main().catch(error=>{console.error("Render failed:",error);process.exit(1);});
