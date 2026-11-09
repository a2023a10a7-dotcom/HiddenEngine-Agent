import { readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const projectId = process.env.PROJECT_ID;
if (!projectId || !/^[a-z0-9-]+$/.test(projectId)) {
  throw new Error("Set a valid PROJECT_ID.");
}

const root = path.resolve("production", "projects", projectId);
const planPath = path.join(root, "VISUAL-PLAN.json");
const manifestPath = path.join(root, "visual-assets", "approved-assets.json");
const plan = JSON.parse(await readFile(planPath, "utf8"));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

if (plan.projectId !== projectId || manifest.projectId !== projectId) {
  throw new Error("Visual plan or asset manifest projectId mismatch.");
}
if (plan.status !== "awaiting_visual_research_and_review" ||
    !Array.isArray(plan.scenes) || !plan.scenes.length) {
  throw new Error("Visual plan is blocked or incomplete.");
}
if (manifest.status !== "approved") {
  throw new Error("Asset manifest status must be approved.");
}
if (!Array.isArray(manifest.assets)) {
  throw new Error("Asset manifest assets must be an array.");
}

const errors = [];
const ready = [];
const assetsByShot = new Map();
const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => stdout += chunk);
  child.stderr.on("data", chunk => stderr += chunk);
  child.on("error", reject);
  child.on("close", code => code === 0
    ? resolve(stdout)
    : reject(new Error(stderr || command + " exited " + code)));
});

for (const asset of manifest.assets) {
  const label = asset.id || "unnamed asset";
  if (!asset.id || !asset.shotId || assetsByShot.has(asset.shotId)) {
    errors.push(label + ": missing asset id/shotId or duplicate shotId.");
    continue;
  }
  if (!/^S\d{2}$/.test(asset.sceneId || "")) {
    errors.push(label + ": sceneId must match S01, S02, etc.");
    continue;
  }
  if (!/^S\d{2}-\d{2}$/.test(asset.shotId) ||
      !asset.shotId.startsWith(asset.sceneId + "-")) {
    errors.push(label + ": shotId must match its scene, e.g. S01-01.");
    continue;
  }
  assetsByShot.set(asset.shotId, asset);

  if (!["image", "video"].includes(asset.mediaType)) {
    errors.push(label + ": mediaType must be image or video.");
    continue;
  }
  if (!/^https:\/\/(commons\.wikimedia\.org|upload\.wikimedia\.org|www\.pexels\.com|images\.pexels\.com|openverse\.org)\//i.test(asset.sourceUrl || "")) {
    errors.push(label + ": source must be Wikimedia Commons, Pexels, or Openverse.");
    continue;
  }
  if (asset.rightsStatus !== "cleared" || asset.editorialVerification !== "approved") {
    errors.push(label + ": rights and editorial approval are both required.");
    continue;
  }
  for (const field of ["sourceUrl", "creator", "license", "licenseEvidence", "territory", "attribution"]) {
    if (!String(asset[field] || "").trim()) errors.push(label + ": missing " + field + ".");
  }
  if (asset.expiry && Date.parse(asset.expiry) < Date.now()) {
    errors.push(label + ": license expiry has passed.");
  }
  if (errors.some(error => error.startsWith(label + ":"))) continue;

  const relative = String(asset.filePath || "");
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..")) {
    errors.push(label + ": filePath must be a safe project-relative path.");
    continue;
  }
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep)) {
    errors.push(label + ": filePath escapes project directory.");
    continue;
  }

  try {
    const info = await stat(file);
    if (!info.isFile() || info.size === 0) throw new Error("file is empty or not a regular file");
    const probe = JSON.parse(await run("ffprobe", [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=codec_type,width,height",
      "-of", "json", file
    ]));
    const streams = probe.streams || [];
    if (!streams.some(stream => stream.codec_type === "video" && stream.width >= 640 && stream.height >= 360)) {
      throw new Error("media has no usable video/image stream or resolution is below 640x360");
    }
    ready.push({
      id: asset.id,
      sceneId: asset.sceneId,
      shotId: asset.shotId,
      mediaType: asset.mediaType,
      filePath: relative,
      sourceUrl: asset.sourceUrl,
      creator: asset.creator,
      license: asset.license,
      licenseEvidence: asset.licenseEvidence,
      territory: asset.territory,
      expiry: asset.expiry || null,
      attribution: asset.attribution,
      sha256: asset.sha256 || null
    });
  } catch (error) {
    errors.push(label + ": " + error.message);
  }
}

const shots = plan.scenes.flatMap(scene =>
  (scene.shots || []).map(shot => ({ sceneId: scene.sceneId, shot }))
);
const shotIds = new Set();

for (const { sceneId, shot } of shots) {
  if (!/^S\d{2}$/.test(sceneId || "") ||
      !/^S\d{2}-\d{2}$/.test(shot.shotId || "") ||
      !shot.shotId.startsWith(sceneId + "-") ||
      shotIds.has(shot.shotId)) {
    errors.push((shot.shotId || "unnamed shot") + ": invalid or duplicate shot identity.");
    continue;
  }
  shotIds.add(shot.shotId);

  if (!shot.visualBrief ||
      !["event", "device", "person", "place", "document", "data"].includes(shot.visualBrief.kind) ||
      !String(shot.visualBrief.subject || "").trim() ||
      !Array.isArray(shot.visualBrief.mustShow) ||
      !shot.visualBrief.mustShow.length) {
    errors.push(shot.shotId + ": required visualBrief is missing or invalid.");
  }
  if (shot.queryQuality !== "needs_human_review" ||
      !String(shot.visualQuery || "").trim()) {
    errors.push(shot.shotId + ": visual query has not passed human-review eligibility checks.");
  }

  const asset = ready.find(item => item.shotId === shot.shotId);
  const fallback = shot.fallback;
  if (!asset && (!fallback || fallback.type !== "data_card" ||
      !String(fallback.title || "").trim() ||
      !String(fallback.body || "").trim())) {
    errors.push(shot.shotId + ": requires an approved asset or a complete data-card fallback.");
  }
  if (!asset && fallback) {
    const hasNumberOrDate = /\d/.test(fallback.title + " " + fallback.body);
    if (hasNumberOrDate &&
        (!Array.isArray(fallback.sourceLines) || !fallback.sourceLines.some(line => String(line).trim()))) {
      errors.push(shot.shotId + ": data card contains a number/date but has no source line.");
    }
  }
}

for (const asset of ready) {
  if (!shotIds.has(asset.shotId)) {
    errors.push(asset.id + ": asset references a shot absent from VISUAL-PLAN.json.");
  }
}

const report = {
  projectId,
  checkedAt: new Date().toISOString(),
  status: errors.length ? "blocked" : "ready",
  assetCount: ready.length,
  shotCount: shots.length,
  shotsWithAssets: ready.map(asset => asset.shotId),
  shotsWithDataCardFallback: shots
    .filter(({ shot }) => !ready.some(asset => asset.shotId === shot.shotId))
    .map(({ shot }) => shot.shotId),
  assets: ready,
  errors,
  rule: "VISUAL-PLAN.json is the only shot segmentation source. Every shot must resolve to a rights-cleared approved asset or a complete sourced data-card fallback."
};

await writeFile(
  path.join(root, "VISUAL-ASSETS-READY.json"),
  JSON.stringify(report, null, 2) + "\n"
);

console.log(JSON.stringify({
  status: report.status,
  shotCount: report.shotCount,
  assetCount: report.assetCount,
  dataCardFallbacks: report.shotsWithDataCardFallback.length,
  errors
}, null, 2));

if (errors.length) process.exit(1);
