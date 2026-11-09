import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const projectId = process.env.PROJECT_ID;
if (!projectId || !/^[a-z0-9-]+$/.test(projectId)) {
  throw new Error("Set a valid PROJECT_ID.");
}

const audioRaw = process.env.AUDIO_TOTAL_SECONDS;
const audioTotalSeconds = audioRaw ? Number(audioRaw) : 0;
if (audioRaw && (!Number.isFinite(audioTotalSeconds) || audioTotalSeconds <= 0)) {
  throw new Error("AUDIO_TOTAL_SECONDS must be a positive number.");
}

const DEFAULT_WORDS_PER_SECOND = 2.4;
const MAX_SCENE_SECONDS = 12;
const MIN_WORDS = 19;
const MAX_WORDS = 24;
const SHORT_TAIL_WORDS = 7;
const MERGE_CAP_WORDS = 27;
const SOURCES = ["Wikimedia Commons", "Pexels", "Openverse"];
const KINDS = new Set(["event", "device", "person", "place", "document", "data"]);
const GENERIC_QUERY_WORDS = new Set([
  "artificial", "intelligence", "technology", "innovation", "future",
  "digital", "business", "concept", "abstract", "ai", "tech",
  "modern", "new", "advanced", "system", "systems", "research",
  "development", "global", "world", "industry", "computer"
]);

const root = path.resolve("production", "projects", projectId);
const draftPath = path.join(root, "SCRIPT-DRAFT.json");
const outputPath = path.join(root, "VISUAL-PLAN.json");
const clean = value => String(value || "").replace(/\\s+/g, " ").trim();
const wordsOf = value => clean(value).split(" ").filter(Boolean);
const countWords = value => wordsOf(value).length;
const round2 = value => Number(value.toFixed(2));
const SENTENCE_END = /[.!?؟؛:]["')\\]”’]*$/;

const draft = JSON.parse(await readFile(draftPath, "utf8"));
if (draft.projectId !== projectId) throw new Error("Project ID mismatch.");
if (!Array.isArray(draft.scenes) || !draft.scenes.length) {
  throw new Error("The script draft contains no scenes.");
}

function splitNarration(text) {
  const words = wordsOf(text);
  const chunks = [];
  let current = [];

  for (const word of words) {
    current.push(word);
    if (current.length >= MIN_WORDS && SENTENCE_END.test(word)) {
      chunks.push(current);
      current = [];
    } else if (current.length >= MAX_WORDS) {
      chunks.push(current);
      current = [];
    }
  }

  if (current.length) {
    if (current.length < SHORT_TAIL_WORDS && chunks.length) {
      const merged = chunks.pop().concat(current);
      if (merged.length <= MERGE_CAP_WORDS) {
        chunks.push(merged);
      } else {
        const midpoint = Math.ceil(merged.length / 2);
        chunks.push(merged.slice(0, midpoint), merged.slice(midpoint));
      }
    } else {
      chunks.push(current);
    }
  }

  return chunks.map(chunk => chunk.join(" "));
}

function isValidBrief(value) {
  return Boolean(
    value &&
    KINDS.has(value.kind) &&
    clean(value.subject) &&
    Array.isArray(value.mustShow) &&
    value.mustShow.length > 0 &&
    value.mustShow.every(item => clean(item))
  );
}

function queryQuality(query) {
  const words = wordsOf(query);
  if (words.length < 2 || words.length > 6) return "blocked";
  const meaningful = words.filter(word =>
    !GENERIC_QUERY_WORDS.has(word.toLowerCase().replace(/[^a-z0-9]/g, ""))
  );
  if (!meaningful.length) return "blocked";

  const hasAnchor = meaningful.some(word =>
    /\\d/.test(word) ||
    /^[A-Z]{2,}[A-Z0-9-]*$/.test(word) ||
    /^[A-Z][a-zA-Z0-9-]{2,}$/.test(word)
  );
  return hasAnchor ? "needs_human_review" : "blocked";
}

function sourceLinesFor(scene, part) {
  const values = Array.isArray(scene.dataCardSourceLines)
    ? scene.dataCardSourceLines
    : [];
  const selected = Array.isArray(values[part]) ? values[part] : [];
  return selected.map(clean).filter(Boolean);
}

const totalWords = draft.scenes.reduce((sum, scene) => {
  const text = (scene.narrationBlocks || [])
    .map(block => clean(block.narrationText))
    .filter(Boolean)
    .join(" ");
  return sum + countWords(text);
}, 0);

const wordsPerSecond = audioTotalSeconds
  ? totalWords / audioTotalSeconds
  : DEFAULT_WORDS_PER_SECOND;

if (!Number.isFinite(wordsPerSecond) || wordsPerSecond <= 0) {
  throw new Error("Could not calculate narration speaking rate.");
}

const scenes = [];
const errors = [];

draft.scenes.forEach((sourceScene, sceneIndex) => {
  const sourceSceneId = clean(sourceScene.id) || `source-scene-${sceneIndex + 1}`;
  const sceneId = `S${String(sceneIndex + 1).padStart(2, "0")}`;
  const narration = (sourceScene.narrationBlocks || [])
    .map(block => clean(block.narrationText))
    .filter(Boolean)
    .join(" ");

  if (!narration) {
    errors.push(`${sceneId}: no narration blocks.`);
    return;
  }

  const segments = splitNarration(narration);
  const suppliedBriefs = Array.isArray(sourceScene.visualBriefs)
    ? sourceScene.visualBriefs
    : segments.length === 1 && sourceScene.visualBrief
      ? [sourceScene.visualBrief]
      : [];
  const suppliedQueries = Array.isArray(sourceScene.visualQueries)
    ? sourceScene.visualQueries
    : segments.length === 1 && sourceScene.visualQuery
      ? [sourceScene.visualQuery]
      : [];

  const shots = segments.map((segment, part) => {
    const shotId = `${sceneId}-${String(part + 1).padStart(2, "0")}`;
    const visualBrief = suppliedBriefs[part] || null;
    const visualQuery = clean(suppliedQueries[part]);
    const queryStatus = queryQuality(visualQuery);
    const estimatedDurationSeconds = round2(countWords(segment) / wordsPerSecond);

    if (!isValidBrief(visualBrief)) {
      errors.push(`${shotId}: visualBrief must include a valid kind, subject, and non-empty mustShow list.`);
    }
    if (queryStatus !== "needs_human_review") {
      errors.push(`${shotId}: visualQuery must contain 2-6 words and a specific named, model, year, place, or document anchor.`);
    }
    if (estimatedDurationSeconds > MAX_SCENE_SECONDS) {
      errors.push(`${shotId}: estimated duration ${estimatedDurationSeconds}s exceeds ${MAX_SCENE_SECONDS}s.`);
    }

    const fallback = isValidBrief(visualBrief)
      ? {
          type: "data_card",
          title: clean(visualBrief.subject),
          body: visualBrief.mustShow.map(clean).join(" · "),
          sourceLines: sourceLinesFor(sourceScene, part)
        }
      : null;

    return {
      shotId,
      narration: segment,
      wordCount: countWords(segment),
      estimatedDurationSeconds,
      measuredDurationSeconds: null,
      visualBrief,
      visualQuery,
      queryQuality: queryStatus,
      permittedSources: SOURCES,
      visualTreatment: {
        preferredMedia: "image",
        motion: "slow_zoom_3_to_5_percent",
        transition: "fade_max_0.5_seconds",
        keepOverlaysClearOfSubtitleArea: true
      },
      fallback
    };
  });

  scenes.push({
    sceneId,
    sourceSceneId,
    title: clean(sourceScene.act || sourceScene.id || "Documentary scene"),
    editorialGoal: clean(sourceScene.editorialGoal),
    shots
  });
});

const shotCount = scenes.reduce((sum, scene) => sum + scene.shots.length, 0);
const estimatedDurations = scenes.flatMap(scene =>
  scene.shots.map(shot => shot.estimatedDurationSeconds)
);
const plan = {
  schemaVersion: "2.0.0",
  projectId,
  createdAt: new Date().toISOString(),
  status: errors.length ? "blocked" : "awaiting_visual_research_and_review",
  timing: {
    source: audioTotalSeconds ? "measured_total_audio_estimate" : "default_speaking_rate_estimate",
    audioTotalSeconds: audioTotalSeconds || null,
    wordsPerSecond: round2(wordsPerSecond),
    maxShotSeconds: MAX_SCENE_SECONDS
  },
  rules: {
    plannerIsOnlySegmentationSource: true,
    noAutomaticAssetApproval: true,
    noUnrelatedImages: true,
    noMusic: true,
    noSoundEffects: true,
    requireLicenseEvidence: true,
    requireHumanEditorialApproval: true,
    requireAssetOrDataCardForEveryShot: true
  },
  sceneCount: scenes.length,
  shotCount,
  averageEstimatedSceneSeconds: estimatedDurations.length
    ? round2(estimatedDurations.reduce((sum, value) => sum + value, 0) / estimatedDurations.length)
    : 0,
  longestEstimatedSceneSeconds: estimatedDurations.length
    ? Math.max(...estimatedDurations)
    : 0,
  errors,
  scenes
};

await mkdir(root, { recursive: true });
await writeFile(outputPath, JSON.stringify(plan, null, 2) + "\n");

console.log(JSON.stringify({
  status: plan.status,
  projectId,
  sceneCount: plan.sceneCount,
  shotCount: plan.shotCount,
  averageEstimatedSceneSeconds: plan.averageEstimatedSceneSeconds,
  longestEstimatedSceneSeconds: plan.longestEstimatedSceneSeconds,
  missingOrInvalidBriefs: errors.filter(error => error.includes("visualBrief")).length,
  invalidQueries: errors.filter(error => error.includes("visualQuery")).length,
  output: outputPath
}, null, 2));

if (errors.length) process.exit(1);
