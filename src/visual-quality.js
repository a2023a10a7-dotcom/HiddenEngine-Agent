// Editorial visual-quality gate and scene-aware asset ranking.
// Assets are illustrative unless separately verified as primary evidence.
const STOP = new Set([
  "the","and","for","with","from","that","this","into","their","they","them","than","then",
  "about","after","before","over","under","when","where","what","which","while","will","would",
  "could","should","have","has","had","were","was","are","is","been","being","its","our","your",
  "company","companies","business","story","scene","chapter","technology","modern"
]);

const SYNONYMS = new Map([
  ["nvidia", ["gpu","graphics card","accelerator","semiconductor","data center","cuda","blackwell","h100"]],
  ["blackwell", ["nvidia","gpu","accelerator","chip","semiconductor"]],
  ["gpu", ["graphics processor","graphics card","accelerator","chip","parallel computing"]],
  ["semiconductor", ["chip","wafer","fabrication","cleanroom","chipmaking","packaging"]],
  ["datacenter", ["data center","server rack","servers","cloud computing","infrastructure"]],
  ["data", ["chart","statistics","revenue","financial","numbers"]],
  ["revenue", ["financial","earnings","sales","annual report","quarterly"]],
  ["taiwan", ["tsmc","semiconductor","chip fabrication","foundry"]],
  ["cuda", ["nvidia","gpu","parallel computing","software"]],
  ["jensen", ["nvidia","leadership","executive"]]
]);

const GENERIC_PENALTIES = [
  ["coffee", 12], ["cup", 10], ["drink", 10], ["beverage", 10],
  ["whiteboard", 5], ["meeting", 3], ["abstract", 5], ["generic background", 6]
];

function normalize(value) {
  return String(value ?? "").toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ").trim();
}

function tokens(value) {
  return normalize(value).split(" ").filter(t => t.length > 2 && !STOP.has(t));
}

function assetText(asset) {
  return normalize([
    asset.title, asset.description, asset.tags, asset.searchQuery,
    asset.query, asset.kind, asset.sceneTitle
  ].filter(Boolean).join(" "));
}

function expandedTokens(values) {
  const result = new Set();
  for (const value of values) {
    for (const token of tokens(value)) result.add(token);
    const n = normalize(value);
    for (const [key, synonyms] of SYNONYMS) {
      if (n.includes(key)) {
        for (const synonym of synonyms) for (const token of tokens(synonym)) result.add(token);
      }
    }
  }
  return result;
}

export function scoreAsset(asset, beat, scene = {}, linkedClaims = []) {
  const haystack = assetText(asset);
  const sources = [
    beat?.narration, beat?.on_screen_text, scene?.title, scene?.subtitle,
    ...(scene?.keywords || []), ...(beat?.entities || []),
    ...linkedClaims.map(c => c?.text)
  ].filter(Boolean);
  const wanted = expandedTokens(sources);
  if (!wanted.size || !haystack) return { score: 0, matches: [], penalties: [] };

  const matches = [...wanted].filter(token => haystack.includes(token));
  let score = matches.reduce((sum, token) => sum + (token.length >= 7 ? 3 : 1), 0);

  // Reward exact scene query/claim entities more than broad technology vocabulary.
  for (const value of [beat?.entities || [], linkedClaims.map(c => c?.entities || []).flat()].flat()) {
    const entity = normalize(value);
    if (entity.length > 2 && haystack.includes(entity)) score += 5;
  }

  const penalties = [];
  for (const [term, weight] of GENERIC_PENALTIES) {
    if (haystack.includes(term)) { score -= weight; penalties.push(term); }
  }
  if (asset.kind === "video") score += 1;
  if (asset.scene === scene?.sceneNumber || asset.scene === scene?.index) score += 2;
  return { score: Math.max(0, score), matches, penalties };
}

export function selectRelevantAsset({ assets, beat, scene, linkedClaims = [], usedIds = new Set(), minScore = 3 }) {
  if (!Array.isArray(assets) || !assets.length) {
    throw new Error("Visual QA: scene has no acquired assets; refusing an ungrounded fallback.");
  }
  const ranked = assets.map(asset => ({
    asset,
    ...scoreAsset(asset, beat, scene, linkedClaims),
    reused: usedIds.has(asset.id)
  })).sort((a, b) =>
    (a.reused - b.reused) ||
    (b.score - a.score) ||
    String(a.asset.id).localeCompare(String(b.asset.id))
  );

  const best = ranked.find(item => item.score >= minScore && !item.reused)
    || ranked.find(item => item.score >= minScore);
  if (!best) {
    const top = ranked.slice(0, 3).map(x => x.asset.id + "=" + x.score).join(", ");
    throw new Error("Visual QA: no scene-relevant asset for beat " + (beat?.id || "?") +
      " (minimum score " + minScore + "). Top candidates: " + (top || "none") +
      ". Re-run visual acquisition with more specific scene queries; do not use a random fallback.");
  }
  return {
    asset: best.asset,
    score: best.score,
    matchedTerms: best.matches,
    penalties: best.penalties,
    reused: best.reused
  };
}

export function validateAssetManifest(manifest, sceneCount) {
  const errors = [];
  if (!manifest || !Array.isArray(manifest.assets)) return ["visual-assets.json must contain an assets array."];
  const ids = new Set();
  for (const asset of manifest.assets) {
    if (!asset?.id || ids.has(asset.id)) errors.push("Asset IDs must be present and unique: " + (asset?.id || "<missing>"));
    ids.add(asset?.id);
    if (!Number.isInteger(asset?.scene) || asset.scene < 1 || asset.scene > sceneCount) errors.push("Asset " + asset?.id + " has an invalid scene index.");
    if (!asset?.previewFile || /(^|\/)\.\.(\/|$)/.test(asset.previewFile)) errors.push("Asset " + asset?.id + " has an unsafe or missing previewFile.");
    if (!asset?.sourcePage || !/^https:\/\//i.test(asset.sourcePage)) errors.push("Asset " + asset?.id + " has no HTTPS provenance page.");
    if (asset.kind === "video" && Number.isFinite(asset.durationSeconds) && asset.durationSeconds <= 0) errors.push("Video asset " + asset.id + " has an invalid duration.");
  }
  for (let scene = 1; scene <= sceneCount; scene++) {
    if (!manifest.assets.some(a => a.scene === scene)) errors.push("Scene " + scene + " has no acquired visual assets.");
  }
  return errors;
}
