const WIDTH = 1920;
const HEIGHT = 1080;

const COLORS = {
  background: "#111315",
  panel: "#191C1F",
  accent: "#C08A58",
  text: "#F0EDE5",
  muted: "#B8B1A7",
  grid: "#34383A"
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
    width="${WIDTH}" height="${HEIGHT}"
    viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <rect width="100%" height="100%" fill="${COLORS.background}"/>
    <text x="120" y="130" fill="${COLORS.accent}"
      font-size="26" font-family="DejaVu Sans"
      letter-spacing="5">THE HIDDEN ENGINE</text>
    <text x="120" y="235" fill="${COLORS.text}"
      font-size="58" font-weight="bold"
      font-family="DejaVu Sans">${escapeXml(title)}</text>
    ${content}
  </svg>`;
}

export function createBarChart({ title, items, source = "SOURCE NOT VERIFIED" }) {
  const data = validateItems(items, 7);
  const values = data.map(item => Number(item.value));

  if (values.some(value => !Number.isFinite(value) || value < 0)) {
    throw new Error("Invalid chart value.");
  }

  const max = Math.max(1, ...values);
  const rows = data.map((item, index) => {
    const value = values[index];
    const y = 350 + index * 90;
    const width = (value / max) * 950;

    return `
      <text x="140" y="${y}" fill="${COLORS.text}" font-size="27">
        ${escapeXml(item.label)}
      </text>
      <rect x="500" y="${y - 28}" width="950" height="24"
        rx="5" fill="${COLORS.grid}"/>
      <rect x="500" y="${y - 28}" width="${width}" height="24"
        rx="5" fill="${COLORS.accent}"/>
      <text x="1500" y="${y}" fill="${COLORS.text}" font-size="25">
        ${escapeXml(item.display ?? value)}
      </text>`;
  }).join("");

  return createSvg(title, `
    <rect x="100" y="275" width="1720" height="690"
      rx="18" fill="${COLORS.panel}"/>
    ${rows}
    <text x="140" y="940" fill="${COLORS.muted}" font-size="20">
      ${escapeXml(source)}
    </text>
  `);
}

export function createTimeline({ title, events }) {
  const data = validateItems(events, 8);
  const start = data.length > 1 ? 260 : 960;
  const gap = data.length > 1 ? 1400 / (data.length - 1) : 0;

  const markers = data.map((event, index) => {
    const x = start + index * gap;
    const label = truncateText(event.label, 22);

    return `
      <circle cx="${x}" cy="550" r="13" fill="${COLORS.accent}"/>
      <text x="${x}" y="490" text-anchor="middle"
        fill="${COLORS.accent}" font-size="24">
        ${escapeXml(event.date)}
      </text>
      <text x="${x}" y="610" text-anchor="middle"
        fill="${COLORS.text}" font-size="19">
        ${escapeXml(label)}
      </text>`;
  }).join("");

  return createSvg(title, `
    <rect x="100" y="330" width="1720" height="430"
      rx="18" fill="${COLORS.panel}"/>
    <path d="M200 550 H1720" stroke="${COLORS.grid}" stroke-width="6"/>
    ${markers}
  `);
}

export function createArchitectureDiagram({ title, nodes, connections = [] }) {
  const data = validateItems(nodes, 8);
  const ids = data.map(node => node.id);

  if (ids.some(id => id === undefined || id === null || id === "") ||
      new Set(ids).size !== ids.length) {
    throw new Error("Architecture nodes require unique, non-empty ids.");
  }

  const positions = data.map((node, index) => ({
    ...node,
    x: 160 + (index % 4) * 450,
    y: 390 + Math.floor(index / 4) * 260
  }));

  const byId = new Map(positions.map(node => [node.id, node]));

  const edges = connections.map(edge => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);

    if (!from || !to) {
      throw new Error("Diagram connection references an unknown node.");
    }
    if (from.id === to.id) {
      throw new Error("Diagram connections cannot loop to the same node.");
    }

    const fromCenterX = from.x + 150;
    const fromCenterY = from.y + 65;
    const toCenterX = to.x + 150;
    const toCenterY = to.y + 65;
    let path;

    if (from.y === to.y) {
      const direction = toCenterX > fromCenterX ? 1 : -1;
      const sx = fromCenterX + direction * 150;
      const ex = toCenterX - direction * 150;
      path = `M${sx} ${fromCenterY} H${ex}`;
    } else if (from.x === to.x) {
      const direction = toCenterY > fromCenterY ? 1 : -1;
      const sy = fromCenterY + direction * 65;
      const ey = toCenterY - direction * 65;
      path = `M${fromCenterX} ${sy} V${ey}`;
    } else {
      const directionX = toCenterX > fromCenterX ? 1 : -1;
      const directionY = toCenterY > fromCenterY ? 1 : -1;
      const sx = fromCenterX + directionX * 150;
      const ex = toCenterX - directionX * 150;
      const midX = (sx + ex) / 2;
      path = `M${sx} ${fromCenterY} H${midX} V${toCenterY} H${ex}`;
      if (directionY < 0) {
        path = `M${sx} ${fromCenterY} H${midX} V${toCenterY} H${ex}`;
      }
    }

    return `<path d="${path}" stroke="${COLORS.accent}"
      stroke-width="5" fill="none" stroke-dasharray="12 9"/>`;
  }).join("");

  const boxes = positions.map(node => `
    <rect x="${node.x}" y="${node.y}" width="300" height="130"
      rx="14" fill="${COLORS.panel}" stroke="${COLORS.accent}" stroke-width="3"/>
    <text x="${node.x + 150}" y="${node.y + 58}" text-anchor="middle"
      fill="${COLORS.text}" font-size="25">${escapeXml(node.label)}</text>
    <text x="${node.x + 150}" y="${node.y + 98}" text-anchor="middle"
      fill="${COLORS.muted}" font-size="17">${escapeXml(node.detail || "")}</text>
  `).join("");

  return createSvg(title, edges + boxes);
}
