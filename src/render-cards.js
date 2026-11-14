// Visual cards for the beat renderer. Each card is an SVG (1920x1080 design space).
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

function frame(inner, act, idx, total) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="2112" height="1188" viewBox="0 0 1920 1080">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#18120c"/><stop offset="1" stop-color="#0a0806"/></linearGradient></defs>
<rect width="1920" height="1080" fill="url(#g)"/>
<rect x="120" y="92" width="64" height="4" fill="${C.gold}"/>
<text x="120" y="140" class="eyebrow">${xml(act)}</text>
<text x="1800" y="140" text-anchor="end" class="brand">THE HIDDEN ENGINE  ${pad(idx)} / ${pad(total)}</text>
${inner}
<style>
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
.hit{font:700 40px 'DejaVu Serif';fill:#9a4a0e;text-decoration:underline}
.attr{font:700 26px 'DejaVu Sans';letter-spacing:3px;fill:${C.gold}}
</style></svg>`;
}

export const figureOf = text => {
  const m = [...String(text).matchAll(/(?:US\$|\$|\u20AC|\u00A3)?\d[\d,]*(?:\.\d+)?\s?(?:%|percent|trillion|billion|million|thousand)?/gi)].map(x => x[0].trim());
  const notYear = m.filter(x => !/^(19|20)\d\d$/.test(x));
  return (notYear[0] || m[0] || "").replace(/\s?percent$/i, "%");
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
  return frame(`<text x="120" y="500" class="big" style="font-size:${size}px">${xml(fig)}</text>${body}<text x="120" y="900" class="src">${xml(sourceLine(claim, sources))}</text>`, act, idx, total);
}
function kineticCard(text, act, idx, total) {
  const rows = wrap(String(text).toUpperCase(), 24, 4).map((l, i) => `<text x="120" y="${430 + i * 110}" class="kin">${xml(l)}</text>`).join("");
  return frame(rows, act, idx, total);
}
// A page from the source document with the verbatim passage; the key figure is highlighted.
function excerptCard(claim, sources, act, idx, total) {
  const s = sourceOf(claim, sources);
  const year = s ? String(s.publishedAt || "").slice(0, 4) : "";
  const head = s ? ([s.publisher, s.title].filter(Boolean).join(" \u2014 ") + (year ? "  (" + year + ")" : "")).toUpperCase().slice(0, 96) : "SOURCE DOCUMENT";
  const hits = new Set(figureOf(claim.text).toLowerCase().split(/\s+/).filter(Boolean).map(t => t.replace(/\.$/, "")));
  const lines = wrap("\u201C" + claim.passageQuote + "\u201D", 58, 7);
  const panelH = 62 + 90 + lines.length * 62 + 30, top = Math.round(180 + (700 - panelH) / 2);
  const rows = lines.map((line, i) => {
    const spans = line.split(" ").map(w => {
      const key = w.toLowerCase().replace(/[\u201C\u201D"',;:()]+/g, "").replace(/\.$/, "");
      return hits.has(key) ? `<tspan class="hit">${xml(w)}</tspan>` : xml(w);
    }).join(" ");
    return `<text x="190" y="${top + 62 + 85 + i * 62}" class="doc" xml:space="preserve">${spans}</text>`;
  }).join("");
  const attr = claim.classification === "attributed" && claim.attribution ? `<text x="120" y="${top + panelH + 60}" class="attr">${xml(("STATED BY: " + claim.attribution).toUpperCase().slice(0, 80))}</text>` : "";
  return frame(`<rect x="120" y="${top}" width="1680" height="${panelH}" rx="6" fill="#EFE8D8"/><rect x="120" y="${top}" width="1680" height="62" rx="6" fill="#D9CFB8"/><text x="150" y="${top + 40}" class="dochead">${xml(head)}</text>${rows}${attr}`, act, idx, total);
}
function diagramCard(steps, act, idx, total) {
  const n = steps.length, gap = 70, w = (1680 - (n - 1) * gap) / n;
  const parts = steps.map((s, i) => {
    const x = 120 + i * (w + gap);
    const t = wrap(s, Math.max(8, Math.floor(w / 17)), 4).map((l, k) => `<text x="${x + w / 2}" y="${470 + k * 38}" text-anchor="middle" class="box">${xml(l)}</text>`).join("");
    const arrow = i < n - 1 ? `<path d="M${x + w + 12} 500 H${x + w + gap - 12} M${x + w + gap - 28} 484 L${x + w + gap - 12} 500 L${x + w + gap - 28} 516" stroke="${C.gold}" stroke-width="4" fill="none"/>` : "";
    return `<rect x="${x}" y="400" width="${w}" height="200" rx="10" fill="#14100c" stroke="${C.gold}" stroke-width="2"/>${t}${arrow}`;
  }).join("");
  return frame(parts, act, idx, total);
}
function timelineCard(events, act, idx, total) {
  const n = events.length, step = 1680 / Math.max(1, n - 1 || 1);
  const parts = events.map((e, i) => {
    const x = n === 1 ? 960 : 120 + i * step;
    const lab = wrap(e.label, 18, 3).map((l, k) => `<text x="${x}" y="${600 + k * 34}" text-anchor="middle" class="lab">${xml(l)}</text>`).join("");
    return `<circle cx="${x}" cy="500" r="12" fill="${C.gold}"/><text x="${x}" y="450" text-anchor="middle" class="date">${xml(e.date)}</text>${lab}`;
  }).join("");
  return frame(`<path d="M120 500 H1800" stroke="#5a5247" stroke-width="3"/>${parts}`, act, idx, total);
}

// Returns { svgs: [svg, ...], warning?: string } for one beat.
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
    case "data_graphic": if (numeric.length) return { svgs: figs() }; break;
    case "source_excerpt": if (quoted) return { svgs: [excerptCard(quoted, sources, act, idx, total)] }; break;
    case "timeline":
      if (Array.isArray(v.events) && v.events.length) return { svgs: [timelineCard(v.events.slice(0, 6), act, idx, total)] };
      if (numeric.length) return { svgs: figs() }; break;
    case "diagram":
      if (Array.isArray(v.steps) && v.steps.length >= 2) return { svgs: [diagramCard(v.steps.slice(0, 5), act, idx, total)] };
      return { svgs: [kinetic()] };
    case "kinetic_text": return { svgs: [kinetic()] };
  }
  return { svgs: numeric.length ? figs() : [kinetic()], warning: b.id + ": visual '" + v.type + "' could not be drawn as requested; used a fallback card." };
}
