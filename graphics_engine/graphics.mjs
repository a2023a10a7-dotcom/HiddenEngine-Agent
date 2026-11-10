const WIDTH = 1920;
const HEIGHT = 1080;

const COLORS = {
  background: "#0D1116",
  panel: "#151C24",
  panelEdge: "#293541",
  accent: "#D6A36B",
  accentBright: "#F0C58F",
  text: "#F3F0E9",
  muted: "#AAB4BE",
  grid: "#2A3540",
  track: "#26313B"
};

function escapeXml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;"
  })[c]);
}

function validateItems(items, max = 8) {
  if (!Array.isArray(items) || !items.length) {
    throw new Error("Graphics require at least one data item.");
  }
  if (items.length > max) {
    throw new Error(`Graphics support at most ${max} data items.`);
  }
  return items;
}

function truncateText(value, limit = 22) {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  return text.slice(0, limit - 1).trimEnd() + "…";
}

function createSvg(title, content) {
  return `<svg xmlns="http://www.w3.org/2000/svg"
    width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#111923"/><stop offset="1" stop-color="#090D12"/>
      </linearGradient>
      <linearGradient id="panel" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#1B2631"/><stop offset="1" stop-color="#121920"/>
      </linearGradient>
      <linearGradient id="gold" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#A97548"/><stop offset=".55" stop-color="#D6A36B"/>
        <stop offset="1" stop-color="#F0C58F"/>
      </linearGradient>
      <radialGradient id="glow">
        <stop offset="0" stop-color="#D6A36B" stop-opacity=".16"/>
        <stop offset="1" stop-color="#D6A36B" stop-opacity="0"/>
      </radialGradient>
      <filter id="softShadow" x="-20%" y="-20%" width="140%" height="150%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="10" result="blur"/>
        <feOffset dy="8" result="offset"/><feComponentTransfer><feFuncA type="linear" slope=".24"/></feComponentTransfer>
        <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
        <path d="M0 0 L10 5 L0 10 Z" fill="#D6A36B"/>
      </marker>
      <pattern id="microGrid" width="48" height="48" patternUnits="userSpaceOnUse">
        <path d="M48 0H0V48" fill="none" stroke="#91A0AE" stroke-opacity=".045" stroke-width="1"/>
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#bg)"/>
    <rect width="100%" height="100%" fill="url(#microGrid)"/>
    <ellipse cx="1640" cy="100" rx="470" ry="280" fill="url(#glow)"/>
    <path d="M120 165H1800" stroke="#42505D" stroke-width="1" opacity=".7"/>
    <path d="M120 165H410" stroke="url(#gold)" stroke-width="3"/>
    <text x="120" y="112" fill="${COLORS.accentBright}" font-size="23"
      font-family="DejaVu Sans" letter-spacing="6" font-weight="bold">THE HIDDEN ENGINE</text>
    <text x="120" y="255" fill="${COLORS.text}" font-size="58" font-weight="bold"
      font-family="DejaVu Sans">${escapeXml(title)}</text>
    ${content}
    <text x="1800" y="1015" text-anchor="end" fill="#74818D"
      font-size="16" font-family="DejaVu Sans" letter-spacing="3">THE HIDDEN ENGINE  /  VISUAL RESEARCH</text>
  </svg>`;
}

function panel(x, y, width, height) {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}"
    rx="22" fill="url(#panel)" stroke="${COLORS.panelEdge}" stroke-width="2"
    filter="url(#softShadow)"/>`;
}

export function createBarChart({ title, items, source = "SOURCE NOT VERIFIED" }) {
  const data = validateItems(items, 7);
  const values = data.map(item => Number(item.value));
  if (values.some(value => !Number.isFinite(value) || value < 0)) {
    throw new Error("Invalid chart value.");
  }
  const max = Math.max(1, ...values);
  const rowGap = Math.min(88, 490 / data.length);
  const firstY = 390 + (490 - rowGap * (data.length - 1)) / 2;
  const rows = data.map((item, index) => {
    const value = values[index];
    const y = firstY + index * rowGap;
    const width = (value / max) * 900;
    const isMax = value === max;
    return `
      <text x="150" y="${y + 8}" fill="${COLORS.text}" font-size="26"
        font-family="DejaVu Sans">${escapeXml(item.label)}</text>
      <rect x="520" y="${y - 18}" width="900" height="25" rx="12"
        fill="${COLORS.track}"/>
      <rect x="520" y="${y - 18}" width="${width}" height="25" rx="12"
        fill="url(#gold)"/>
      ${isMax ? `<circle cx="${520 + width}" cy="${y - 5}" r="7" fill="${COLORS.accentBright}"/>` : ""}
      <text x="1470" y="${y + 8}" fill="${isMax ? COLORS.accentBright : COLORS.text}"
        font-size="26" font-weight="${isMax ? "bold" : "normal"}"
        font-family="DejaVu Sans">${escapeXml(item.display ?? value)}</text>`;
  }).join("");
  const grid = [0, .25, .5, .75, 1].map(t => {
    const x = 520 + 900 * t;
    return `<path d="M${x} 325V${firstY + rowGap * (data.length - 1) + 38}"
      stroke="${COLORS.grid}" stroke-width="1" stroke-dasharray="4 9"/>`;
  }).join("");
  return createSvg(title, `
    ${panel(100, 300, 1720, 650)}
    <text x="150" y="350" fill="${COLORS.muted}" font-size="17"
      letter-spacing="2" font-family="DejaVu Sans">COMPARISON</text>
    ${grid}${rows}
    <path d="M150 875H1770" stroke="${COLORS.panelEdge}" stroke-width="2"/>
    <text x="150" y="915" fill="${COLORS.muted}" font-size="18"
      font-family="DejaVu Sans">${escapeXml(source)}</text>
  `);
}

export function createTimeline({ title, events }) {
  const data = validateItems(events, 8);
  const left = 190, right = 1730, lineY = 570;
  const gap = data.length > 1 ? (right - left) / (data.length - 1) : 0;
  const markers = data.map((event, index) => {
    const x = data.length > 1 ? left + index * gap : 960;
    const above = index % 2 === 0;
    const cardY = above ? 350 : 650;
    const cardH = 145;
    const cardW = Math.min(190, data.length === 1 ? 360 : gap - 24);
    const cardX = Math.max(125, Math.min(1795 - cardW, x - cardW / 2));
    const connectorStart = above ? cardY + cardH : lineY + 18;
    const connectorEnd = above ? lineY - 18 : cardY;
    const label = truncateText(event.label, data.length >= 7 ? 19 : 25);
    return `
      <path d="M${x} ${connectorStart}V${connectorEnd}" stroke="${COLORS.accent}"
        stroke-width="2" opacity=".8"/>
      <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}"
        rx="14" fill="#202B35" stroke="${COLORS.panelEdge}" stroke-width="2"/>
      <rect x="${cardX}" y="${cardY}" width="4" height="${cardH}"
        rx="2" fill="url(#gold)"/>
      <text x="${cardX + 16}" y="${cardY + 36}" fill="${COLORS.accentBright}"
        font-size="20" font-weight="bold" font-family="DejaVu Sans">${escapeXml(event.date)}</text>
      <text x="${cardX + 16}" y="${cardY + 78}" fill="${COLORS.text}"
        font-size="${data.length >= 7 ? 16 : 18}" font-family="DejaVu Sans">${escapeXml(label)}</text>
      <circle cx="${x}" cy="${lineY}" r="17" fill="#10171E" stroke="${COLORS.accent}"
        stroke-width="5"/>
      <circle cx="${x}" cy="${lineY}" r="6" fill="${COLORS.accentBright}"/>`;
  }).join("");
  return createSvg(title, `
    ${panel(100, 315, 1720, 520)}
    <path d="M150 ${lineY}H1770" stroke="${COLORS.grid}" stroke-width="8" stroke-linecap="round"/>
    <path d="M150 ${lineY}H1770" stroke="url(#gold)" stroke-width="2" opacity=".7"/>
    ${markers}
  `);
}


export function createExplodedDiagram({ title, components }) {
  const data = validateItems(components, 6);
  const centerX = 960;
  const startY = 365;
  const layerGap = Math.min(92, 500 / data.length);
  const layers = data.map((part, index) => {
    const y = startY + index * layerGap;
    const depth = 30 + index * 5;
    const width = 760 - index * 48;
    const x = centerX - width / 2;
    const points = `${centerX},${y - depth} ${x + width},${y} ${centerX},${y + depth} ${x},${y}`;
    return `
      <path d="M${centerX} ${y + depth + 4}V${y + layerGap - depth - 4}" stroke="#D6A36B" stroke-width="3" stroke-dasharray="7 8" opacity=".8"/>
      <polygon points="${points}" fill="#24313D" stroke="#D6A36B" stroke-width="2"/>
      <path d="M${x} ${y}V${y + 28}L${centerX} ${y + depth + 28}L${x + width} ${y + 28}V${y}" fill="#17212B" stroke="#526170" stroke-width="1.5"/>
      <text x="${centerX}" y="${y + 8}" text-anchor="middle" fill="#F3F0E9" font-size="22" font-weight="bold" font-family="DejaVu Sans">${escapeXml(part.label)}</text>
      <text x="${centerX + width / 2 + 40}" y="${y + 8}" fill="#AAB4BE" font-size="17" font-family="DejaVu Sans">${escapeXml(part.detail || "")}</text>
    `;
  }).join("");
  return createSvg(title, `${panel(100, 300, 1720, 650)}
    <text x="150" y="350" fill="#AAB4BE" font-size="16" letter-spacing="2" font-family="DejaVu Sans">EXPLODED TECHNICAL VIEW</text>
    ${layers}`);
}

export function createArchitectureDiagram({ title, nodes, connections = [] }) {
  const data = validateItems(nodes, 8);
  const ids = data.map(node => node.id);
  if (ids.some(id => id === undefined || id === null || id === "") ||
      new Set(ids).size !== ids.length) {
    throw new Error("Architecture nodes require unique, non-empty ids.");
  }
  const positions = data.map((node, index) => ({
    ...node, x: 160 + (index % 4) * 450, y: 390 + Math.floor(index / 4) * 260
  }));
  const byId = new Map(positions.map(node => [node.id, node]));
  const edges = connections.map(edge => {
    const from = byId.get(edge.from), to = byId.get(edge.to);
    if (!from || !to) throw new Error("Diagram connection references an unknown node.");
    if (from.id === to.id) throw new Error("Diagram connections cannot loop to the same node.");
    const fx = from.x + 150, fy = from.y + 65, tx = to.x + 150, ty = to.y + 65;
    let sx, sy, ex, ey, path;
    if (from.y === to.y) {
      const dir = tx > fx ? 1 : -1;
      sx = fx + dir * 150; ex = tx - dir * 150;
      path = `M${sx} ${fy}H${ex}`;
    } else if (from.x === to.x) {
      const dir = ty > fy ? 1 : -1;
      sy = fy + dir * 65; ey = ty - dir * 65;
      path = `M${fx} ${sy}V${ey}`;
    } else {
      const dirX = tx > fx ? 1 : -1;
      sx = fx + dirX * 150; ex = tx - dirX * 150;
      const midX = (sx + ex) / 2;
      path = `M${sx} ${fy}H${midX}V${ty}H${ex}`;
    }
    return `<path d="${path}" stroke="${COLORS.accent}" stroke-width="4"
      fill="none" opacity=".85" marker-end="url(#arrow)"/>`;
  }).join("");
  const boxes = positions.map(node => `
    <rect x="${node.x}" y="${node.y}" width="300" height="130" rx="16"
      fill="#1B2732" stroke="#526170" stroke-width="2" filter="url(#softShadow)"/>
    <path d="M${node.x + 18} ${node.y + 3}H${node.x + 282}"
      stroke="url(#gold)" stroke-width="4" stroke-linecap="round"/>
    <text x="${node.x + 150}" y="${node.y + 58}" text-anchor="middle"
      fill="${COLORS.text}" font-size="24" font-weight="bold"
      font-family="DejaVu Sans">${escapeXml(node.label)}</text>
    <text x="${node.x + 150}" y="${node.y + 98}" text-anchor="middle"
      fill="${COLORS.muted}" font-size="17"
      font-family="DejaVu Sans">${escapeXml(node.detail || "")}</text>
  `).join("");
  return createSvg(title, `
    ${panel(100, 315, 1720, 560)}
    <text x="150" y="355" fill="${COLORS.muted}" font-size="16"
      letter-spacing="2" font-family="DejaVu Sans">SYSTEM ARCHITECTURE</text>
    ${edges}${boxes}
  `);
}
