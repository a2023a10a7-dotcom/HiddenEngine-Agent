import test from "node:test";
import assert from "node:assert/strict";
import { scoreAsset, selectRelevantAsset, validateAssetManifest } from "../src/visual-quality.js";

const beat = {
  id: "S01-B1",
  narration: "NVIDIA designs Blackwell GPU accelerators for AI data centers.",
  entities: ["NVIDIA", "Blackwell"]
};
const scene = { title: "The AI accelerator", keywords: ["GPU", "data center"], sceneNumber: 1 };
const claims = [{ text: "NVIDIA's Blackwell GPU accelerator architecture." }];

test("ranks a scene-matched GPU asset above generic office imagery", () => {
  const relevant = { id: "gpu", kind: "video", scene: 1, tags: "NVIDIA GPU Blackwell accelerator data center", searchQuery: "Blackwell GPU" };
  const irrelevant = { id: "office", kind: "photo", scene: 1, tags: "office meeting whiteboard coffee" };
  assert.ok(scoreAsset(relevant, beat, scene, claims).score > scoreAsset(irrelevant, beat, scene, claims).score);
  assert.equal(selectRelevantAsset({ assets: [irrelevant, relevant], beat, scene, linkedClaims: claims }).asset.id, "gpu");
});

test("rejects a pool with no credible topical match instead of selecting randomly", () => {
  assert.throws(() => selectRelevantAsset({
    assets: [{ id: "coffee", kind: "photo", scene: 1, tags: "coffee cup drink" }],
    beat, scene, linkedClaims: claims
  }), /no scene-relevant asset/);
});

test("avoids reusing an asset when another relevant asset exists", () => {
  const a = { id: "a", kind: "photo", scene: 1, tags: "NVIDIA GPU Blackwell chip accelerator" };
  const b = { id: "b", kind: "photo", scene: 1, tags: "GPU data center NVIDIA accelerator Blackwell" };
  assert.equal(selectRelevantAsset({
    assets: [a, b], beat, scene, linkedClaims: claims, usedIds: new Set(["a"])
  }).asset.id, "b");
});

test("validates provenance, safe paths, and scene coverage", () => {
  const errors = validateAssetManifest({ assets: [
    { id: "ok", scene: 1, previewFile: "ok.jpg", sourcePage: "https://pixabay.com/photos/ok/" },
    { id: "bad", scene: 2, previewFile: "../secret.jpg", sourcePage: "http://example.com" }
  ] }, 2);
  assert.ok(errors.some(x => x.includes("unsafe or missing previewFile")));
  assert.ok(errors.some(x => x.includes("HTTPS provenance")));
});
