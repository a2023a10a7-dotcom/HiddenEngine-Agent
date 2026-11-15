// Visual cards for the beat renderer. A card is { base, layers }:
//   base   = static SVG (background, act label, brand line)
//   layers = [{ svg, delay }] transparent SVGs that fade and slide in one after another.
// To add a visual type, add a function here and a branch in cardsForBeat(). No other file needs to change.
const C = { ink: "#F0EDE5", mute: "#D5D1C8", gold: "#C08A58", dim: "#8d8579" };
export const xml = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
const pad = n => String(n).padStart(2, "0");
export const wrap = (text, max, maxLines = 99) => {
  const rows = []; let line = "";
  for (const w of String(text).split(/\s+/).filter(Boolean)) {
    if (line && (line + " " + w).length > max) { rows.push(line); line = w; } else line = line ? line + " " + w : w;
  }
  if (line) rows.push(line);
  return rows.slice(0, maxLines);
};

// 1:1 scale; the canvas has 96px (left/right) and 54px (top/bottom) of extra margin around the 1920x1080 design,
// so the 1920x1080 camera window can drift without ever cutting content off.
const OPEN = '<svg xmlns="http://www.w3.org/2000/svg" width="2112" height="1188" viewBox="-96 -54 2112 1188">';
const STYLE = `<style>
.eyebrow{font:700 24px 'DejaVu Sans';letter-spacing:5px;fill:${C.gold}}
.brand{font:400 20px 'DejaVu Sans';letter-spacing:4px;fill:${C.dim}}
.big{font:700 170px 'DejaVu Sans';fill:${C.ink}}
.claim{font:400 42px 'DejaVu Sans';fill:${C.mute}}
.src{font:400 25px 'DejaVu Sans';letter-spacing:1px;fill:${C.gold}}
.kin{font:700 86px 'DejaVu Sans';fill:${C.ink}}
.box{font:700 30px 'DejaVu Sans';fill:${C.ink}}
.date{font:700 28px 'DejaVu Sans';fill:${C.gold}}
.lab{font:400 26px 'DejaVu Sans';fill:${C.mute}}
.dochead{font:700 20px 'DejaVu Sans';letter-spacing:3px;fill:#7a6a55}
.doc{font:400 40px 'DejaVu Serif';fill:#1d1914}
.hit{font:400 40px 'DejaVu Serif';fill:#b4540c;text-decoration:underline}
.attr{font:700 26px 'DejaVu Sans';letter-spacing:3px;fill:${C.gold}}
</style>`;
const layerSvg = inner => OPEN + inner + STYLE + "</svg>";
function baseSvg(act, idx, total) {
  return OPEN + `<defs><radialGradient id="g" cx="50%" cy="42%" r="80%"><stop offset="0" stop-color="#241a10"/><stop offset="1" stop-color="#0a0806"/></radialGradient></defs>
<rect x="-96" y="-54" width="2112" height="1188" fill="#090806" fill-opacity="0.48"/>
<rect x="120" y="92" width="64" height="4" fill="${C.gold}"/>
<text x="120" y="140" class="eyebrow">${xml(act)}</text>
<text x="1800" y="140" text-anchor="end" class="brand">THE HIDDEN ENGINE  ${pad(idx)} / ${pad(total)}</text>` + STYLE + "</svg>";
}
// parts: array of SVG element strings, revealed one after another.
const card = (parts, act, idx, total, step = 0.35) => ({ base: baseSvg(act, idx, total), layers: parts.map((p, i) => ({ svg: layerSvg(p), delay: 0.2 + i * step })) });

export const figureOf = text => {
  // Prefer actual measures (currency, percentage, or scaled units) and ignore
  // fiscal years, quarter numbers, and form identifiers such as "10-K".
  const raw = String(text);
  const matches = [
    ...raw.matchAll(/(?:US\$|[$€£])\s?\d[\d,]*(?:\.\d+)?\s?(?:trillion|billion|million|thousand)?/gi),
    ...raw.matchAll(/(?<![A-Za-z0-9])\d+(?:\.\d+)?\s?(?:%|percent|trillion|billion|million|thousand)\b/gi)
  ].map(m => ({ value: m[0].trim(), index: m.index ?? 0 }));
  matches.sort((a, b) => a.index - b.index);
  return (matches[0]?.value || "").replace(/\s?percent$/i, "%");
};
function sourceOf(claim, sources) { return (claim.sourceIds || []).map(id => sources.get(id)).find(Boolean); }
function sourceLine(claim, sources) {
  const s = sourceOf(claim, sources);
  if (!s) return "";
  const year = String(s.publishedAt || "").slice(0, 4);
  return ("SOURCE: " + [s.publisher, s.title].filter(Boolean).join(" \u2014 ") + (year ? " (" + year + ")" : "")).slice(0, 110);
}

function figureCard(claim, sources, act, idx, total) {
  const fig = figureOf(claim.text) || "";
  const size = fig.length > 14 ? 110 : fig.length > 9 ? 140 : 170;
  const body = wrap(claim.text, 56, 4).map((l, i) => `<text x="120" y="${650 + i * 58}" class="claim">${xml(l)}</text>`).join("");
  return card([
    `<text x="120" y="500" class="big" style="font-size:${size}px">${xml(fig)}</text>`,
    body,
    `<text x="120" y="900" class="src">${xml(sourceLine(claim, sources))}</text>`
  ], act, idx, total, 0.45);
}
function kineticCard(text, act, idx, total) {
  const rows = wrap(String(text).toUpperCase(), 24, 4).map((l, i) => `<text x="120" y="${430 + i * 110}" class="kin">${xml(l)}</text>`);
  return card(rows, act, idx, total, 0.3);
}
// A page from the source document with the verbatim passage; the key figure is then highlighted.
function excerptCard(claim, sources, act, idx, total) {
  const s = sourceOf(claim, sources);
  const year = s ? String(s.publishedAt || "").slice(0, 4) : "";
  const head = s ? ([s.publisher, s.title].filter(Boolean).join(" \u2014 ") + (year ? "  (" + year + ")" : "")).toUpperCase().slice(0, 96) : "SOURCE DOCUMENT";
  const hits = new Set(figureOf(claim.text).toLowerCase().split(/\s+/).filter(Boolean).map(t => t.replace(/\.$/, "")));
  const lines = wrap("\u201C" + claim.passageQuote + "\u201D", 58, 7);
  const panelH = 62 + 90 + lines.length * 62 + 30, top = Math.round(180 + (700 - panelH) / 2);
  const keyOf = w => w.toLowerCase().replace(/[\u201C\u201D"',;:()]+/g, "").replace(/\.$/, "");
  const y = i => top + 62 + 85 + i * 62;
  const plain = lines.map((line, i) => `<text x="190" y="${y(i)}" class="doc" xml:space="preserve">${xml(line)}</text>`).join("");
  const marked = lines.map((line, i) => ({ i, spans: line.split(" ").map(w => hits.has(keyOf(w)) ? `<tspan class="hit">${xml(w)}</tspan>` : `<tspan fill-opacity="0">${xml(w)}</tspan>`).join(" "), any: line.split(" ").some(w => hits.has(keyOf(w))) }))
    .filter(r => r.any).map(r => `<text x="190" y="${y(r.i)}" class="doc" xml:space="preserve">${r.spans}</text>`).join("");
  const parts = [
    `<rect x="120" y="${top}" width="1680" height="${panelH}" rx="6" fill="#EFE8D8"/><rect x="120" y="${top}" width="1680" height="62" rx="6" fill="#D9CFB8"/><text x="150" y="${top + 40}" class="dochead">${xml(head)}</text>`,
    plain
  ];
  if (marked) parts.push(marked);
  if (claim.classification === "attributed" && claim.attribution) parts.push(`<text x="120" y="${top + panelH + 60}" class="attr">${xml(("STATED BY: " + claim.attribution).toUpperCase().slice(0, 80))}</text>`);
  return card(parts, act, idx, total, 0.5);
}
function diagramCard(steps, act, idx, total) {
  const n = steps.length, gap = 70, w = (1680 - (n - 1) * gap) / n;
  const parts = steps.map((s, i) => {
    const x = 120 + i * (w + gap);
    const t = wrap(s, Math.max(8, Math.floor(w / 17)), 4).map((l, k) => `<text x="${x + w / 2}" y="${470 + k * 38}" text-anchor="middle" class="box">${xml(l)}</text>`).join("");
    const arrow = i < n - 1 ? `<path d="M${x + w + 12} 500 H${x + w + gap - 12} M${x + w + gap - 28} 484 L${x + w + gap - 12} 500 L${x + w + gap - 28} 516" stroke="${C.gold}" stroke-width="4" fill="none"/>` : "";
    return `<rect x="${x}" y="400" width="${w}" height="200" rx="10" fill="#14100c" stroke="${C.gold}" stroke-width="2"/>${t}${arrow}`;
  });
  return card(parts, act, idx, total, 0.4);
}
function timelineCard(events, act, idx, total) {
  const n = events.length, step = 1680 / Math.max(1, n - 1 || 1);
  const parts = [`<path d="M120 500 H1800" stroke="#5a5247" stroke-width="3"/>`, ...events.map((e, i) => {
    const x = n === 1 ? 960 : 120 + i * step;
    const lab = wrap(e.label, 18, 3).map((l, k) => `<text x="${x}" y="${600 + k * 34}" text-anchor="middle" class="lab">${xml(l)}</text>`).join("");
    return `<circle cx="${x}" cy="500" r="12" fill="${C.gold}"/><text x="${x}" y="450" text-anchor="middle" class="date">${xml(e.date)}</text>${lab}`;
  })];
  return card(parts, act, idx, total, 0.3);
}

// Returns { cards: [card, ...], warning?: string } for one beat.
export function cardsForBeat(b, ctx) {
  const { claims, sources, act, idx, total } = ctx;
  const v = b.visual || {};
  const linked = (b.claim_ids || []).map(id => claims.get(id)).filter(Boolean);
  const dataClaims = (v.data_claim_ids || []).map(id => claims.get(id)).filter(Boolean);
  const numeric = (dataClaims.length ? dataClaims : linked).filter(c => figureOf(c.text));
  const figs = () => numeric.map(c => figureCard(c, sources, act, idx, total));
  const kinetic = () => kineticCard(b.on_screen_text || v.description || act, act, idx, total);
  const quoted = linked.find(c => c.passageQuote);
  switch (v.type) {
    case "data_graphic": if (numeric.length) return { cards: figs() }; break;
    case "source_excerpt": if (quoted) return { cards: [excerptCard(quoted, sources, act, idx, total)] }; break;
    case "timeline":
      if (Array.isArray(v.events) && v.events.length) return { cards: [timelineCard(v.events.slice(0, 6), act, idx, total)] };
      if (numeric.length) return { cards: figs() }; break;
    case "diagram":
      if (Array.isArray(v.steps) && v.steps.length >= 2) return { cards: [diagramCard(v.steps.slice(0, 5), act, idx, total)] };
      return { cards: [kinetic()] };
    case "kinetic_text": return { cards: [kinetic()] };
  }
  return { cards: numeric.length ? figs() : [kinetic()], warning: b.id + ": visual '" + v.type + "' could not be drawn as requested; used a fallback card." };
}