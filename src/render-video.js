import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const PROJECT_ID = process.env.PROJECT_ID;
if (!PROJECT_ID || !/^[a-z0-9-]+$/.test(PROJECT_ID)) {
  throw new Error("PROJECT_ID is missing or invalid.");
}
const ROOT = path.join("production", "projects", PROJECT_ID);
const SCRIPT_PATH = path.join(ROOT, "script.json");
const OUT = path.join("dist", PROJECT_ID);

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() :
      reject(new Error(command + " exited with code " + code)));
  });
}
function escapeXml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;"
  })[char]);
}
function wrapWords(text, maxChars = 42) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line && (line + " " + word).length > maxChars) {
      lines.push(line);
      line = word;
    } else line = line ? line + " " + word : word;
  }
  if (line) lines.push(line);
  return lines;
}
function sceneSvg(scene, index, total) {
  const titleLines = wrapWords(scene.title.toUpperCase(), 27);
  const subLines = wrapWords(scene.subtitle, 42);
  const title = titleLines.map((line, i) =>
    '<text x="110" y="' + (255 + i * 78) + '" class="title">' + escapeXml(line) + "</text>"
  ).join("\n");
  const subtitleY = 300 + titleLines.length * 78;
  const subtitle = subLines.map((line, i) =>
    '<text x="116" y="' + (subtitleY + i * 48) + '" class="sub">' + escapeXml(line) + "</text>"
  ).join("\n");
  const bars = Array.from({length: 18}, (_, i) => {
    const h = 18 + ((i * 31 + index * 17) % 100);
    return '<rect x="' + (1180 + i * 30) + '" y="' + (770 - h) +
      '" width="12" height="' + h + '" rx="6" fill="#65d6c4" opacity="' +
      (0.18 + (i % 4) * 0.1).toFixed(2) + '"/>';
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#071522"/><stop offset="1" stop-color="#142d40"/>
    </linearGradient>
    <radialGradient id="glow"><stop offset="0" stop-color="#1b9b91" stop-opacity=".34"/><stop offset="1" stop-color="#1b9b91" stop-opacity="0"/></radialGradient>
    <style>
      .brand{font:700 30px 'DejaVu Sans';letter-spacing:7px;fill:#65d6c4}
      .title{font:700 66px 'DejaVu Sans';fill:#f4f7fa}
      .sub{font:400 34px 'DejaVu Sans';fill:#b8cbd6}
      .small{font:400 22px 'DejaVu Sans';fill:#9eb3c0}
    </style>
  </defs>
  <rect width="1920" height="1080" fill="url(#bg)"/>
  <circle cx="1510" cy="380" r="620" fill="url(#glow)"/>
  <path d="M0 850 L1920 580" stroke="#65d6c4" stroke-opacity=".12" stroke-width="2"/>
  <path d="M0 900 L1920 630" stroke="#65d6c4" stroke-opacity=".08" stroke-width="2"/>
  <g opacity=".7">${bars}</g>
  <text x="110" y="115" class="brand">THE HIDDEN ENGINE</text>
  <rect x="110" y="160" width="90" height="6" rx="3" fill="#65d6c4"/>
  ${title}
  ${subtitle}
  <text x="110" y="960" class="small">TECHNOLOGY • ENGINEERING • STRATEGY</text>
  <text x="1790" y="960" text-anchor="end" class="small">${String(index + 1).padStart(2,"0")} / ${total}</text>
  </svg>`;
}
async function main() {
  const script = JSON.parse(await readFile(SCRIPT_PATH, "utf8"));
  if (!Array.isArray(script.scenes) || !script.scenes.length) {
    throw new Error("script.json has no scenes.");
  }
  await mkdir(OUT, { recursive: true });
  const videoFiles = [];
  const audioFiles = [];
  for (let i = 0; i < script.scenes.length; i++) {
    const scene = script.scenes[i];
    if (!scene.narration?.trim()) throw new Error("Scene " + (i + 1) + " has no narration.");
    const stem = "scene-" + String(i + 1).padStart(2, "0");
    const svgPath = path.join(OUT, stem + ".svg");
    const wavPath = path.join(OUT, stem + ".wav");
    const mp4Path = path.join(OUT, stem + ".mp4");
    await writeFile(svgPath, sceneSvg(scene, i, script.scenes.length));
    await run("espeak-ng", ["-v", script.voice || "en-us", "-s", "145", "-a", "175",
      "-w", wavPath, scene.narration]);
    await run("ffmpeg", ["-y", "-loop", "1", "-framerate", "25", "-i", svgPath,
      "-i", wavPath, "-vf", "format=yuv420p", "-c:v", "libx264", "-preset", "veryfast",
      "-tune", "stillimage", "-c:a", "aac", "-b:a", "128k", "-shortest",
      "-movflags", "+faststart", mp4Path]);
    videoFiles.push(mp4Path);
    audioFiles.push(wavPath);
  }
  const videoList = path.join(OUT, "videos.txt");
  await writeFile(videoList, videoFiles.map((f) =>
    "file '" + path.basename(f) + "'").join("\n") + "\n");
  const output = path.join(OUT, "the-hidden-engine-documentary.mp4");
  await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", videoList,
    "-c", "copy", "-movflags", "+faststart", output]);
  const readme = [
    "# Render output",
    "",
    "Video: the-hidden-engine-documentary.mp4",
    "Narration: generated locally with eSpeak NG (synthetic voice; review pronunciation and pacing).",
    "Visuals: original generated title cards, not archival footage.",
    "No music or third-party footage is included.",
    "This is a first assembly draft. Review all facts, pronunciation, pacing, captions, and visual design before publication."
  ].join("\n");
  await writeFile(path.join(OUT, "README.txt"), readme + "\n");
  console.log("Rendered: " + output);
}
main().catch((error) => {
  console.error("Render failed:", error);
  process.exit(1);
});
