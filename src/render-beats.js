// Beat-based renderer: scene-matched photography, motion-graphic overlays, and narration for every beat.
// Reads production/projects/<id>/script.json (beats) and project.json (claims, sources).
// Needs: ffmpeg (with libass and librsvg), Piper TTS. Usage: PROJECT_ID=<folder> node src/render-beats.js
// Dry run without a voice model: TTS_FAKE=1 (silent audio with estimated length).
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { cardsForBeat } from "./render-cards.js";

const ID = process.env.PROJECT_ID;
if (!ID || !/^[a-z0-9-]+$/.test(ID)) throw new Error("PROJECT_ID is missing or invalid.");
const ROOT = path.join("production", "projects", ID);
const OUT = path.join("dist", ID, "work");
const FINAL_DIR = path.join("dist", ID);
const PIPER_EXECUTABLE = process.env.PIPER_EXECUTABLE || "piper";
const PIPER_MODEL = process.env.PIPER_MODEL || "models/piper-voice.onnx";
const PIPER_LENGTH_SCALE = Number(process.env.PIPER_LENGTH_SCALE || "1.0");
const FAKE = process.env.TTS_FAKE === "1";
const AMBIENT = process.env.AMBIENT === "1";
const FPS = 25, GAP = 0.25;

const run = (cmd, args, cwd) => new Promise((resolve, reject) => {
  const child = spawn(cmd, args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
  let err = ""; child.stderr.on("data", d => err = (err + d).slice(-1500));
  child.on("error", reject);
  child.on("close", code => code === 0 ? resolve() : reject(new Error(cmd + " exited with code " + code + ": " + err)));
});
const capture = (cmd, args) => new Promise((resolve, reject) => {
  const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = ""; child.stdout.on("data", d => out += d); child.stderr.on("data", d => err += d);
  child.on("error", reject);
  child.on("close", code => code === 0 ? resolve(out) : reject(new Error(cmd + " exited with code " + code + ": " + err.slice(-800))));
});
const probeDuration = async f => Number((await capture("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", f])).trim());
const pad = n => String(n).padStart(2, "0");
const words = s => String(s).trim().split(/\s+/).filter(Boolean);

// ---------- voice ----------
async function tts(text, out) {
  const clean = String(text).replace(/\s+/g, " ").trim();
  if (!clean) throw new Error("Empty narration.");
  if (FAKE) { await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "anullsrc=r=22050:cl=mono", "-t", Math.max(1.5, words(clean).length / 2.6).toFixed(2), "-c:a", "pcm_s16le", out]); return; }
  if (!Number.isFinite(PIPER_LENGTH_SCALE) || PIPER_LENGTH_SCALE <= 0) throw new Error("PIPER_LENGTH_SCALE must be positive.");
  await access(PIPER_MODEL).catch(() => { throw new Error("Piper voice model not found: " + PIPER_MODEL); });
  const sentences = clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [clean];
  const chunks = []; let cur = [], n = 0;
  for (const s of sentences) {
    const w = words(s);
    if (n + w.length > 55 && cur.length) { chunks.push(cur.join(" ")); cur = []; n = 0; }
    cur.push(s.trim()); n += w.length;
  }
  if (cur.length) chunks.push(cur.join(" "));
  const base = out.replace(/\.wav$/, ""), parts = [];
  for (const [i, chunk] of chunks.entries()) {
    const part = base + ".p" + i + ".wav";
    await new Promise((resolve, reject) => {
      const child = spawn(PIPER_EXECUTABLE, ["--model", PIPER_MODEL, "--output_file", part, "--length_scale", String(PIPER_LENGTH_SCALE)], { stdio: ["pipe", "ignore", "pipe"] });
      let err = ""; child.stderr.on("data", d => err = (err + d).slice(-800));
      child.on("error", reject); child.stdin.on("error", reject);
      child.on("close", code => code === 0 ? resolve() : reject(new Error("Piper exited with code " + code + ": " + err)));
      child.stdin.end(chunk);
    });
    parts.push(part);
  }
  if (parts.length === 1) { await run("ffmpeg", ["-y", "-i", parts[0], "-c:a", "pcm_s16le", out]); return; }
  const list = base + ".txt";
  await writeFile(list, parts.map(p => "file '" + path.basename(p) + "'").join("\n") + "\n");
  await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c:a", "pcm_s16le", out]);
}

// ---------- subtitles ----------
const ass = t => { const cs = Math.max(0, Math.round(t * 100)); return Math.floor(cs / 360000) + ":" + pad(Math.floor(cs % 360000 / 6000)) + ":" + pad(Math.floor(cs % 6000 / 100)) + "." + pad(cs % 100); };
function subtitles(text, duration) {
  const ws = words(text), cues = []; let group = [], rows = [], line = "";
  for (const w of ws) {
    const cand = line ? line + " " + w : w;
    if (line && cand.length > 58) { rows.push(line); line = w; } else line = cand;
    if (rows.length === 2) { cues.push({ n: group.length, text: rows.join("\\N") }); group = []; rows = []; }
    group.push(w);
  }
  if (line) rows.push(line);
  if (rows.length) cues.push({ n: group.length, text: rows.join("\\N") });
  const total = ws.length || 1; let at = 0;
  const events = cues.map((c, i) => { const start = at, end = i === cues.length - 1 ? duration : at + duration * c.n / total; at = end; return "Dialogue: 0," + ass(start) + "," + ass(end) + ",Default,,0,0,0,," + c.text.replace(/[{}]/g, ""); });
  return ["[Script Info]", "ScriptType: v4.00+", "PlayResX: 1920", "PlayResY: 1080", "WrapStyle: 2", "", "[V4+ Styles]",
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
    "Style: Default,DejaVu Sans,44,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,3,1,2,160,160,60,1", "",
    "[Events]", "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text", ...events].join("\n") + "\n";
}

// ---------- main ----------
async function main() {
  const script = JSON.parse(await readFile(path.join(ROOT, "script.json"), "utf8"));
  const project = JSON.parse(await readFile(path.join(ROOT, "project.json"), "utf8"));
  const claims = new Map((project.research?.claims || []).map(c => [c.id, c]));
  const sources = new Map((project.research?.sources || []).map(s => [s.id, s]));
  if (!script.scenes?.length) throw new Error("script.json has no scenes.");
  await mkdir(OUT, { recursive: true });
  const total = script.scenes.length, segs = [], warnings = [], usedSources = new Set();
  const assetManifestPath = path.join(ROOT, "visual-assets.json");
  const assetManifest = JSON.parse(await readFile(assetManifestPath, "utf8"));
  const assetsByScene = new Map();
  for (const asset of assetManifest.assets || []) {
    const list = assetsByScene.get(asset.scene) || [];
    list.push(asset);
    assetsByScene.set(asset.scene, list);
  }
  for (let i = 1; i <= total; i++) {
    if ((assetsByScene.get(i) || []).length < 6) throw new Error("Scene " + i + " has fewer than six cleared-to-use visual assets; refusing a text-only render.");
  }
  let beatNo = 0;
  for (const [si, sc] of script.scenes.entries()) {
    if (!sc.beats?.length) throw new Error("Scene " + (si + 1) + " has no beats. Run the compile stage and the gate first.");
    const act = String(sc.title || "SCENE " + (si + 1)).toUpperCase();
    for (const [bi, b] of sc.beats.entries()) {
      beatNo++;
      const stem = "b" + String(beatNo).padStart(3, "0");
      const wav = path.join(OUT, stem + ".wav");
      await tts(b.narration, wav);
      const audioDur = await probeDuration(wav);
      if (!(audioDur > 0)) throw new Error("Empty audio for beat " + b.id);
      const dur = audioDur + GAP;

      // visual cards for this beat
      (b.claim_ids || []).forEach(id => (claims.get(id)?.sourceIds || []).forEach(s => usedSources.add(s)));
      const { cards, warning } = cardsForBeat(b, { claims, sources, act, idx: si + 1, total });
      if (warning) warnings.push(warning);

      const first = bi === 0, last = bi === sc.beats.length - 1;
      await writeFile(path.join(OUT, stem + ".ass"), subtitles(b.narration, audioDur));
      // Each card = background + layers that fade and slide in one after another.
      // The background drifts slowly and the layers drift faster, which gives depth (parallax).
      const inputs = [], graph = [], forward = beatNo % 2 === 0;
      let nIn = 0;
      for (const [k, cardK] of cards.entries()) {
        const d = dur / cards.length, fexp = forward ? "t/" + d.toFixed(3) : "(1-t/" + d.toFixed(3) + ")";
        const pos = m => "x='(iw-1920)*" + m + "*" + fexp + "':y='(ih-1080)*" + m + "*" + fexp + "'";
        const sceneAssets = assetsByScene.get(si + 1) || [];
        const visual = sceneAssets[bi % sceneAssets.length];
        const visualPath = path.resolve(FINAL_DIR, visual.previewFile);
        await access(visualPath).catch(() => { throw new Error("Missing visual asset " + visual.id + ": " + visualPath); });
        const imageInput = nIn++;
        inputs.push("-loop", "1", "-framerate", String(FPS), "-t", d.toFixed(3), "-i", visualPath);
        const files = [cardK.base, ...cardK.layers.map(l => l.svg)], pngs = [];
        for (const [j, svg] of files.entries()) {
          const name = stem + "-" + k + "-" + j;
          await writeFile(path.join(OUT, name + ".svg"), svg);
          await run("ffmpeg", ["-y", "-i", name + ".svg", "-frames:v", "1", name + ".png"], OUT);
          pngs.push(name + ".png");
          inputs.push("-loop", "1", "-framerate", String(FPS), "-t", d.toFixed(3), "-i", name + ".png");
        }
        if (k === 0) {
          await run("ffmpeg", ["-y", "-i", visualPath, "-vf", "scale=480:270:force_original_aspect_ratio=increase,crop=480:270", "-frames:v", "1", stem + ".jpg"], OUT);
        }
        const base = nIn; nIn += pngs.length;
        graph.push("[" + imageInput + ":v]scale=2112:1188:force_original_aspect_ratio=increase,crop=2112:1188,setsar=1[bg" + k + "]");
        graph.push("[bg" + k + "][" + base + ":v]overlay=0:0:shortest=1,crop=1920:1080:" + pos("0.45") + ",setsar=1,fps=" + FPS + "[g" + k + "_0]");
        let prev = "g" + k + "_0";
        for (let j = 0; j < cardK.layers.length; j++) {
          const dl = Math.min(cardK.layers[j].delay, d * 0.4).toFixed(2);
          graph.push("[" + (base + 1 + j) + ":v]crop=1920:1080:" + pos("1") + ",format=rgba,fade=t=in:st=" + dl + ":d=0.4:alpha=1[l" + k + "_" + j + "]");
          graph.push("[" + prev + "][l" + k + "_" + j + "]overlay=x=0:y='24*pow(1-min(1,max(0,(t-" + dl + ")/0.55)),2)':format=auto[g" + k + "_" + (j + 1) + "]");
          prev = "g" + k + "_" + (j + 1);
        }
        graph.push("[" + prev + "]null[c" + k + "]");
      }
      const n = cards.length;
      if (n > 1) graph.push(cards.map((_, k) => "[c" + k + "]").join("") + "concat=n=" + n + ":v=1:a=0[cv]"); else graph.push("[c0]null[cv]");
      const fx = (first ? ",fade=t=in:st=0:d=0.3" : "") + (last ? ",fade=t=out:st=" + Math.max(0, dur - 0.3).toFixed(2) + ":d=0.3" : "");
      await run("ffmpeg", ["-y", ...inputs, "-i", stem + ".wav", "-filter_complex", graph.join(";") + ";[cv]noise=alls=4:allf=t,subtitles=" + stem + ".ass" + fx + ",format=yuv420p[v]",
        "-map", "[v]", "-map", nIn + ":a", "-af", "apad=pad_dur=" + GAP, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-t", dur.toFixed(3), stem + ".mp4"], OUT);
      segs.push(stem);
      console.log("Beat " + beatNo + " (" + b.id + "): " + dur.toFixed(1) + "s, " + cards.length + " card(s)");
    }
  }
  await writeFile(path.join(OUT, "concat.txt"), segs.map(s => "file '" + s + ".mp4'").join("\n") + "\n");
  await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", "concat.txt", "-c", "copy", "raw.mp4"], OUT);
  const final = path.join(FINAL_DIR, "the-hidden-engine-documentary.mp4");
  const loud = "loudnorm=I=-16:TP=-1.5:LRA=11";
  if (AMBIENT) {
    // Original synthesized ambient pad (no licensed music), far below the voice, mixed before loudness normalization.
    const T = (await probeDuration(path.join(OUT, "raw.mp4"))).toFixed(2), tones = [[55, 0.11], [82.41, 0.13], [110, 0.17], [164.81, 0.21]];
    const src = tones.map(([f, r], i) => "sine=f=" + f + ":d=" + T + ",tremolo=f=" + r + ":d=0.55[t" + i + "]").join(";");
    const bed = "[t0][t1][t2][t3]amix=inputs=4:normalize=0,lowpass=f=520,aecho=0.8:0.9:700|1100:0.35|0.25,volume=" + (process.env.AMBIENT_GAIN || "0.12") + ",afade=t=in:d=4,afade=t=out:st=" + Math.max(0, Number(T) - 5).toFixed(2) + ":d=5[bed]";
    await run("ffmpeg", ["-y", "-i", "raw.mp4", "-filter_complex", src + ";" + bed + ";[0:a][bed]amix=inputs=2:duration=first:normalize=0," + loud + "[a]", "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", path.resolve(final)], OUT);
  } else {
    await run("ffmpeg", ["-y", "-i", "raw.mp4", "-c:v", "copy", "-af", loud, "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", path.resolve(final)], OUT);
  }

  // contact sheet: up to 24 evenly spaced frames
  const pick = segs.filter((_, i) => segs.length <= 24 || i % Math.ceil(segs.length / 24) === 0);
  await writeFile(path.join(OUT, "sheet.txt"), pick.map(s => "file '" + s + ".jpg'\nduration 1").join("\n") + "\n");
  await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", "sheet.txt", "-vf", "fps=1,tile=4x" + Math.ceil(pick.length / 4), "-frames:v", "1", path.resolve(path.join(FINAL_DIR, "contact-sheet.jpg"))], OUT);

  // technical QA
  const info = JSON.parse(await capture("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", final]));
  const vs = info.streams.find(s => s.codec_type === "video"), au = info.streams.find(s => s.codec_type === "audio");
  if (!vs || vs.width !== 1920 || vs.height !== 1080) throw new Error("QA: output is not 1920x1080 video.");
  if (!au) throw new Error("QA: output has no audio stream.");
  const credits = ["# Credits and sources", "", "Visuals: scene-matched photographs from Pixabay, with restrained motion graphics and documentary subtitles.", ...((assetManifest.assets || []).map(a => "- " + a.id + ": " + a.creator + " — " + a.sourcePage + " (Pixabay Content License: " + a.licenseUrl + ")")),
    FAKE ? "Narration: SILENT DRY RUN, not a publishable render." : "Narration: Piper neural TTS (local, free).", AMBIENT ? "Music: original synthesized ambient pad generated by the renderer (no third-party music)." : "Music: none.", "", "## Sources used",
    ...[...usedSources].map(id => { const s = sources.get(id); return s ? "- " + (s.publisher || "") + "\u2014" + (s.title || "") + " " + (s.canonicalUrl || s.url || "") : "- " + id; }), ""].join("\n");
  await writeFile(path.join(FINAL_DIR, "CREDITS.md"), credits);
  await writeFile(path.join(FINAL_DIR, "QA-REPORT.json"), JSON.stringify({ file: path.basename(final), width: vs.width, height: vs.height, durationSeconds: Number(info.format.duration), audio: true, beats: segs.length, scenes: total, dryRun: FAKE, ambientBed: AMBIENT, visualAssets: assetManifest.assetCount, visualSource: "Pixabay", warnings,
    note: "Technical QA only. Facts are checked by the script gate and by human review of FACT-CHECK-SHEET.md." }, null, 2) + "\n");
  console.log("Rendered: " + final + (warnings.length ? " | warnings: " + warnings.length : ""));
}
main().catch(e => { console.error("Render failed:", e); process.exit(1); });