const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_VISION_MODEL || "gemini-2.5-flash";

export function extractJson(text) {
  const clean = String(text || "").trim().replace(/^\x60\x60\x60(?:json)?\s*/i, "").replace(/\s*\x60\x60\x60$/, "");
  return JSON.parse(clean);
}

export function validateVisualDecision(value, candidateCount) {
  const index = Number(value?.selectedIndex);
  if (!Number.isInteger(index) || index < -1 || index >= candidateCount) throw new Error("Gemini visual review returned an invalid candidate index.");
  const confidence = Number(value?.confidence);
  const rationale = String(value?.rationale || "");
  const visibleSubject = String(value?.visibleSubject || "");
  if (index === -1 || !Number.isFinite(confidence) || confidence < 0.72) {
    return { accepted: false, rationale: index === -1 ? (rationale || "No suitable image.") : "Rejected: visual confidence below 0.72. " + rationale, confidence: Number.isFinite(confidence) ? confidence : 0, visibleSubject };
  }
  return { accepted: true, selectedIndex: index, rationale, confidence, visibleSubject };
}

export async function selectVisualCandidate({ narrationExcerpt, sceneTitle, visualQuery, candidates }) {
  if (!apiKey) throw new Error("GEMINI_API_KEY is required. Visual selection is fail-closed: no image may be selected by tags alone.");
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const parts = [{
    text: [
      "You are the visual director for an evidence-led English-language documentary.",
      "Inspect every attached candidate image itself. Do not decide from tags or filenames alone.",
      "Choose one image only if its visible content directly and clearly supports the narration excerpt.",
      "Reject generic technology/factory imagery when the narration names a specific product, place, event, person, or process that is not visibly identifiable.",
      "Stock imagery may be illustrative, but must never be represented as proof of a named event or company.",
      "If no candidate is sufficiently relevant, set selectedIndex to -1.",
      "Return JSON only. selectedIndex is zero-based. rationale must explain visible evidence and any limitation.",
      "Scene: " + sceneTitle,
      "Narration excerpt: " + narrationExcerpt,
      "Search brief: " + visualQuery,
      "Candidates:"
    ].join("\n")
  }];

  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    const response = await fetch(candidate.hit.webformatURL, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error("Could not download candidate preview for visual inspection (HTTP " + response.status + ")");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 4096 || bytes.length > 8 * 1024 * 1024) throw new Error("Candidate preview size is invalid for visual inspection.");
    parts.push({ text: "Candidate index " + index + "; Pixabay tags (context only, not proof): " + String(candidate.hit.tags || "") });
    parts.push({ inlineData: { mimeType: "image/jpeg", data: bytes.toString("base64") } });
  }

  const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(apiKey);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(90000),
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            selectedIndex: { type: "INTEGER" },
            rationale: { type: "STRING" },
            confidence: { type: "NUMBER" },
            visibleSubject: { type: "STRING" }
          },
          required: ["selectedIndex", "rationale", "confidence", "visibleSubject"]
        }
      }
    })
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error("Gemini visual review failed (HTTP " + response.status + "): " + detail.slice(0, 500));
  }
  const payload = await response.json();
  const text = payload.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("");
  if (!text) throw new Error("Gemini visual review returned no structured decision.");
  const decision = extractJson(text);
  const validated = validateVisualDecision(decision, candidates.length);
  if (!validated.accepted) return validated;
  return { ...validated, candidate: candidates[validated.selectedIndex] };
}
