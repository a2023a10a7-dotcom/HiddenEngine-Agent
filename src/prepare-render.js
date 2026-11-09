import { readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const projectId = process.env.PROJECT_ID;
if (!projectId || !/^[a-z0-9-]+$/.test(projectId)) {
  throw new Error("Set a valid PROJECT_ID.");
}

const dir = path.resolve("production", "projects", projectId);
const draftPath = path.join(dir, "SCRIPT-DRAFT.json");
const approvalPath = path.join(dir, "SCRIPT-APPROVAL.json");
const projectPath = path.join(dir, "project.json");
const planPath = path.join(dir, "VISUAL-PLAN.json");
const readyPath = path.join(dir, "VISUAL-ASSETS-READY.json");

const [draftText, approvalText, projectText, planText, readyText] = await Promise.all([
  readFile(draftPath, "utf8"),
  readFile(approvalPath, "utf8"),
  readFile(projectPath, "utf8"),
  readFile(planPath, "utf8"),
  readFile(readyPath, "utf8")
]);

const draft = JSON.parse(draftText);
const approval = JSON.parse(approvalText);
const project = JSON.parse(projectText);
const plan = JSON.parse(planText);
const ready = JSON.parse(readyText);
const digest = createHash("sha256").update(draftText).digest("hex");
const errors = [];

if (draft.projectId !== projectId || approval.projectId !== projectId ||
    plan.projectId !== projectId || ready.projectId !== projectId) {
  errors.push("Project ID mismatch across draft, approval, visual plan, or asset report.");
}
if (draft.status !== "evidence_linked_draft_needs_human_rewrite") {
  errors.push("Script draft is blocked or has an unexpected status.");
}
if (approval.status !== "approved_for_recording") {
  errors.push("SCRIPT-APPROVAL.json must set status to approved_for_recording.");
}
if (!approval.approvedBy?.trim()) errors.push("Approval must identify approvedBy.");
if (!approval.approvedAt || Number.isNaN(Date.parse(approval.approvedAt))) {
  errors.push("Approval must include a valid approvedAt timestamp.");
}
if (approval.draftSha256 !== digest) {
  errors.push("Approval hash does not match the current SCRIPT-DRAFT.json.");
}
if (plan.sourceDraftSha256 !== digest) {
  errors.push("VISUAL-PLAN.json was not generated from the currently approved SCRIPT-DRAFT.json.");
}
if (plan.status !== "awaiting_visual_research_and_review" ||
    !Array.isArray(plan.scenes) || !plan.scenes.length) {
  errors.push("VISUAL-PLAN.json is blocked or incomplete.");
}
if (ready.status !== "ready" || ready.errors?.length) {
  errors.push("Visual asset validation report is not ready.");
}

const draftScenes = new Map((draft.scenes || []).map(scene => [scene.id, scene]));
const readyByShot = new Map((ready.assets || []).map(asset => [asset.shotId, asset]));
const renderScenes = [];
const seenSceneIds = new Set();
const seenShotIds = new Set();

for (const plannedScene of plan.scenes || []) {
  const { sceneId, sourceSceneId, shots } = plannedScene;
  if (!/^S\d{2}$/.test(sceneId || "") || seenSceneIds.has(sceneId)) {
    errors.push("Invalid or duplicate visual sceneId: " + (sceneId || "missing"));
    continue;
  }
  seenSceneIds.add(sceneId);
  const source = draftScenes.get(sourceSceneId);
  if (!source) {
    errors.push(sceneId + ": sourceSceneId does not exist in SCRIPT-DRAFT.json.");
    continue;
  }

  const expectedNarration = (source.narrationBlocks || [])
    .map(block => String(block.narrationText || "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ");
  const actualNarration = (shots || [])
    .map(shot => String(shot.narration || "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ");

  if (!Array.isArray(shots) || !shots.length) {
    errors.push(sceneId + ": no shots in visual plan.");
    continue;
  }
  if (actualNarration !== expectedNarration) {
    errors.push(sceneId + ": shot narration does not exactly preserve the approved source narration.");
  }

  for (const shot of shots) {
    if (!/^S\d{2}-\d{2}$/.test(shot.shotId || "") ||
        !shot.shotId.startsWith(sceneId + "-") || seenShotIds.has(shot.shotId)) {
      errors.push("Invalid or duplicate shotId: " + (shot.shotId || "missing"));
      continue;
    }
    seenShotIds.add(shot.shotId);
    if (!shot.narration?.trim()) errors.push(shot.shotId + ": narration is empty.");
    if (!Number.isFinite(shot.estimatedDurationSeconds) ||
        shot.estimatedDurationSeconds <= 0) {
      errors.push(shot.shotId + ": invalid estimated duration.");
    }
    if (shot.measuredDurationSeconds !== null) {
      errors.push(shot.shotId + ": measured duration must be null before rendering.");
    }

    const asset = readyByShot.get(shot.shotId) || null;
    if (!asset && !shot.fallback?.type) {
      errors.push(shot.shotId + ": no approved asset or data-card fallback.");
    }
    if (asset && asset.sceneId !== sceneId) {
      errors.push(shot.shotId + ": approved asset sceneId mismatch.");
    }

    const sourceTitle = shots.indexOf(shot) === 0 ? plannedScene.title : "";
    renderScenes.push({
      sceneId,
      shotId: shot.shotId,
      sourceSceneId,
      title: sourceTitle,
      subtitle: shots.indexOf(shot) === 0 ? plannedScene.editorialGoal : "",
      narration: shot.narration,
      estimatedDurationSeconds: shot.estimatedDurationSeconds,
      measuredDurationSeconds: null,
      visualAsset: asset,
      visual: !asset && shot.fallback?.type === "data_card" ? {
        type: "metric",
        source_label: (shot.fallback.sourceLines || []).join(" | ") || "SOURCE LINE REQUIRED",
        value: shot.fallback.title,
        detail: shot.fallback.body
      } : null
    });
  }
}

for (const scene of draft.scenes || []) {
  for (const block of scene.narrationBlocks || []) {
    if (!block.narrationText?.trim()) errors.push("Claim " + (block.claimId || "unknown") + " has empty narration.");
    if (!["verified", "attributed", "estimated", "analysis"].includes(block.classification)) {
      errors.push("Claim " + (block.claimId || "unknown") + " has an ineligible classification.");
    }
    if (block.editorialStatus !== "approved") errors.push("Claim " + (block.claimId || "unknown") + " is not editorially approved.");
    if (block.factCheck?.exactPassageConfirmed !== true) errors.push("Claim " + (block.claimId || "unknown") + " has not passed exact source-passage review.");
    if (!Array.isArray(block.sourceRefs) || !block.sourceRefs.length) errors.push("Claim " + (block.claimId || "unknown") + " has no source references.");
    if ((block.sourceRefs || []).some(ref => !ref.passageReference?.trim())) {
      errors.push("Claim " + (block.claimId || "unknown") + " has a source without a precise passage/page/table reference.");
    }
  }
}

if (errors.length) {
  console.error(JSON.stringify({ status: "blocked", errors }, null, 2));
  process.exit(1);
}

const durations = renderScenes.map(scene => scene.estimatedDurationSeconds);
const renderScript = {
  schemaVersion: "2.0.0",
  projectId,
  topic: draft.topic,
  language: draft.language,
  targetDurationSeconds: draft.targetDurationSeconds,
  approvedBy: approval.approvedBy,
  approvedAt: approval.approvedAt,
  sourceDraftSha256: digest,
  visualPlanSchemaVersion: plan.schemaVersion,
  scenes: renderScenes,
  averageEstimatedSceneSeconds: Number((durations.reduce((sum, value) => sum + value, 0) / durations.length).toFixed(2)),
  longestEstimatedSceneSeconds: Number(Math.max(...durations).toFixed(2))
};

const destination = path.join(dir, "script.json");
const temporary = destination + ".tmp";
await writeFile(temporary, JSON.stringify(renderScript, null, 2) + "\n");
await rename(temporary, destination);

project.approvals = project.approvals || {};
project.approvals.script = {
  status: "approved_for_recording",
  approvedBy: approval.approvedBy,
  approvedAt: approval.approvedAt,
  draftSha256: digest
};
project.updatedAt = new Date().toISOString();
await writeFile(projectPath, JSON.stringify(project, null, 2) + "\n");

console.log(JSON.stringify({
  status: "ready_for_render",
  projectId,
  scenes: plan.scenes.length,
  shots: renderScenes.length,
  approvedVisuals: renderScenes.filter(scene => scene.visualAsset).length,
  dataCardFallbacks: renderScenes.filter(scene => scene.visual && !scene.visualAsset).length,
  output: destination
}, null, 2));
