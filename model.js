import { units } from "./geometry.js";
export const clone = (x) => structuredClone(x);
export const id = () => globalThis.crypto.randomUUID();
export const presets = {
  round: [44, 57, 58, 59, 68, 73, 75],
  square: [50, 61, 63.5],
  sticker: [30, 40, 50],
};
export const colors = {
  cut: "#666666",
  face: "#3b82c4",
  safe: "#318469",
  marks: "#222222",
};
export function newItem(type = "round", face = 68, outer = 78) {
  return {
    id: id(),
    type,
    face,
    outer,
    safe: 3,
    x: 5,
    y: 5,
    notes: "",
    background: "#ffffff",
    image: null,
    texts: [],
  };
}
export function newPage() {
  return {
    id: id(),
    name: "หน้ากระดาษ",
    paper: { width: 210, height: 297, top: 5, right: 5, bottom: 5, left: 5 },
    layout: { gapX: 2, gapY: 2, cols: 0, rows: 0 },
    items: [],
  };
}
export function newProject() {
  const p = {
    version: 2,
    name: "โปรเจกต์ใหม่",
    unit: "mm",
    assets: {},
    pages: [newPage()],
    styles: Object.fromEntries(
      ["cut", "face", "safe", "marks"].map((k) => [
        k,
        {
          color: colors[k],
          width: 0.2,
          opacity: 1,
          dash: k === "face" ? "2 1" : k === "safe" ? "0.3 1" : "",
          preview: true,
          export: k === "cut",
          size: 3,
          offset: 1,
        },
      ]),
    ),
    cropMarks: false,
    registration: false,
  };
  p.pages[0].items = gridItems(p.pages[0], newItem());
  return p;
}
export function gridItems(page, design) {
  const { paper: p, layout: l } = page,
    d = design.outer;
  if (l.mode === "staggered")
    return staggeredSlots(page, d, design.type !== "square").map((pos) => ({
      ...clone(design),
      id: id(),
      ...pos,
    }));
  const maxCols = Math.max(
      0,
      Math.floor((p.width - p.left - p.right + l.gapX + 1e-9) / (d + l.gapX)),
    ),
    maxRows = Math.max(
      0,
      Math.floor((p.height - p.top - p.bottom + l.gapY + 1e-9) / (d + l.gapY)),
    );
  const cols = l.cols || maxCols,
    rows = l.rows || maxRows;
  if (cols > maxCols || rows > maxRows)
    throw Error("จำนวนแถวหรือคอลัมน์เกินพื้นที่กระดาษ กรุณาลดจำนวน");
  if (cols * rows > 1000) throw Error("รองรับสูงสุด 1,000 ชิ้นต่อหน้า");
  return Array.from({ length: cols * rows }, (_, i) => ({
    ...clone(design),
    id: id(),
    x: p.left + (i % cols) * (d + l.gapX),
    y: p.top + Math.floor(i / cols) * (d + l.gapY),
  }));
}
// Geometry uses a 0.001 mm tolerance to ignore floating-point contact noise.
export function itemsIntersect(a, b, epsilon = 0.001) {
  const ar = a.outer / 2,
    br = b.outer / 2;
  const ax = a.x + ar,
    ay = a.y + ar,
    bx = b.x + br,
    by = b.y + br;
  if (a.type !== "square" && b.type !== "square")
    return Math.hypot(ax - bx, ay - by) < ar + br - epsilon;
  if (a.type === "square" && b.type === "square")
    return (
      Math.min(a.x + a.outer, b.x + b.outer) - Math.max(a.x, b.x) > epsilon &&
      Math.min(a.y + a.outer, b.y + b.outer) - Math.max(a.y, b.y) > epsilon
    );
  const circle = a.type === "square" ? b : a;
  const square = a.type === "square" ? a : b;
  const r = circle.outer / 2,
    cx = circle.x + r,
    cy = circle.y + r;
  const x = Math.max(square.x, Math.min(cx, square.x + square.outer));
  const y = Math.max(square.y, Math.min(cy, square.y + square.outer));
  return Math.hypot(cx - x, cy - y) < r - epsilon;
}
function staggeredSlots(page, diameter, circles) {
  const p = page.paper,
    l = page.layout;
  const dy = diameter + l.gapY;
  const dx = circles
    ? Math.max(
        (diameter + l.gapX) / 2,
        Math.sqrt(Math.max(0, (diameter + l.gapX) ** 2 - (dy / 2) ** 2)),
      )
    : diameter + l.gapX;
  const slots = [];
  for (
    let col = 0;
    p.left + col * dx + diameter <= p.width - p.right + 1e-7;
    col++
  ) {
    for (
      let row = 0;
      p.top + ((col % 2) * dy) / 2 + row * dy + diameter <=
      p.height - p.bottom + 1e-7;
      row++
    ) {
      slots.push({
        x: p.left + col * dx,
        y: p.top + ((col % 2) * dy) / 2 + row * dy,
      });
      if (slots.length > 1000) throw Error("รองรับสูงสุด 1,000 ชิ้นต่อหน้า");
    }
  }
  return slots;
}
export function packItems(page) {
  if (page.layout.mode === "staggered" && page.items.length) {
    const d = Math.max(...page.items.map((a) => a.outer));
    const slots = staggeredSlots(
      page,
      d,
      page.items.every((a) => a.type !== "square"),
    );
    if (slots.length < page.items.length)
      throw Error("พื้นที่ไม่พอ กรุณาย้ายบางชิ้นไปหน้าใหม่");
    page.items.forEach((a, i) => Object.assign(a, slots[i]));
    return;
  }

  const p = page.paper,
    l = page.layout;
  let x = p.left,
    y = p.top,
    rowH = 0;
  const positions = [];
  for (const a of page.items) {
    if (a.outer > p.width - p.left - p.right)
      throw Error("ชิ้นงานกว้างเกินกระดาษ");
    if (x + a.outer > p.width - p.right + 1e-8) {
      x = p.left;
      y += rowH + l.gapY;
      rowH = 0;
    }
    if (y + a.outer > p.height - p.bottom + 1e-8)
      throw Error("พื้นที่ไม่พอ กรุณาย้ายบางชิ้นไปหน้าใหม่");
    positions.push({ x, y });
    x += a.outer + l.gapX;
    rowH = Math.max(rowH, a.outer);
  }
  positions.forEach((pos, i) => Object.assign(page.items[i], pos));
}
export function pageWarnings(page) {
  const p = page.paper,
    w = [];
  for (let i = 0; i < page.items.length; i++) {
    const a = page.items[i];
    if (
      a.x < p.left - 1e-7 ||
      a.y < p.top - 1e-7 ||
      a.x + a.outer > p.width - p.right + 1e-7 ||
      a.y + a.outer > p.height - p.bottom + 1e-7
    )
      w.push(`ชิ้นที่ ${i + 1} เกินพื้นที่พิมพ์`);
    for (let j = 0; j < i; j++) {
      const b = page.items[j];
      if (itemsIntersect(a, b)) w.push(`ชิ้นที่ ${j + 1} และ ${i + 1} ทับกัน`);
    }
  }
  return w;
}
export function productionWarnings(project, page) {
  const out = pageWarnings(page),
    s = project.styles.marks,
    p = page.paper;
  if (s.export && project.cropMarks) {
    const reach = s.offset + s.size + s.width / 2;
    for (let i = 0; i < page.items.length; i++) {
      const a = page.items[i];
      if (
        a.x - reach < 0 ||
        a.y - reach < 0 ||
        a.x + a.outer + reach > p.width ||
        a.y + a.outer + reach > p.height
      )
        out.push(`เครื่องหมายตัดชิ้นที่ ${i + 1} เกินกระดาษ`);
    }
  }
  if (
    s.export &&
    project.registration &&
    Math.min(p.top, p.right, p.bottom, p.left) < s.size + s.width
  )
    out.push("พื้นที่ขอบกระดาษไม่พอสำหรับเครื่องหมายจัดตำแหน่ง");
  return out;
}
export function pageIndices(value, total, current) {
  if (value === "current") return [current];
  if (value === "all") return Array.from({ length: total }, (_, i) => i);
  const out = new Set();
  for (const part of value.split(",")) {
    const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) throw Error("ช่วงหน้าต้องเป็นตัวเลข เช่น 1,3-5");
    const start = Number(m[1]),
      end = Number(m[2] || m[1]);
    if (start < 1 || end > total || end < start)
      throw Error("ช่วงหน้าอยู่นอกโปรเจกต์");
    for (let n = start; n <= end; n++) out.add(n - 1);
  }
  return [...out].sort((a, b) => a - b);
}
export function parseCSV(text) {
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw Error("CSV มีเครื่องหมายคำพูดที่ไม่ปิด");
  row.push(cell);
  if (row.some((v) => v !== "")) rows.push(row);
  if (rows.length < 2) throw Error("CSV ต้องมีหัวตารางและข้อมูล");
  const headers = rows.shift().map((s) => s.replace(/^\uFEFF/, "").trim());
  if (new Set(headers).size !== headers.length)
    throw Error("ชื่อคอลัมน์ CSV ซ้ำ");
  return rows.map((r) =>
    Object.fromEntries(headers.map((h, i) => [h, r[i] || ""])),
  );
}
export function mergeText(template, record) {
  return template.replace(
    /\{\{([^{}]+)\}\}/g,
    (_, key) => record[key.trim()] ?? "",
  );
}
const positive = (v, max = 2000) => Number.isFinite(v) && v > 0 && v <= max;
const nonnegative = (v, max = 2000) => Number.isFinite(v) && v >= 0 && v <= max;
const color = (v) => typeof v === "string" && /^#[\da-f]{6}$/i.test(v);
export function validateProject(p) {
  if (
    !p ||
    p.version !== 2 ||
    !units[p.unit] ||
    typeof p.name !== "string" ||
    p.name.length > 200 ||
    !Array.isArray(p.pages) ||
    p.pages.length < 1 ||
    p.pages.length > 100
  )
    throw Error("รูปแบบโปรเจกต์ไม่ถูกต้อง (รองรับเวอร์ชัน 2, 1–100 หน้า)");
  if (!p.assets || typeof p.assets !== "object" || Array.isArray(p.assets))
    throw Error("ข้อมูลภาพไม่ถูกต้อง");
  for (const a of Object.values(p.assets))
    if (
      !a ||
      typeof a.data !== "string" ||
      !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(a.data) ||
      !positive(a.width, 50000) ||
      !positive(a.height, 50000)
    )
      throw Error("ภาพต้องเป็น PNG, JPEG หรือ WebP ที่ถูกต้อง");
  let count = 0;
  for (const pg of p.pages) {
    const q = pg.paper,
      l = pg.layout;
    if (
      !q ||
      !l ||
      !positive(q.width) ||
      !positive(q.height) ||
      !["top", "right", "bottom", "left"].every((k) => nonnegative(q[k])) ||
      q.left + q.right >= q.width ||
      q.top + q.bottom >= q.height ||
      (l.mode !== undefined && !["grid", "staggered"].includes(l.mode)) ||
      !nonnegative(l.gapX) ||
      !nonnegative(l.gapY) ||
      !["cols", "rows"].every(
        (k) => Number.isInteger(l[k]) && nonnegative(l[k], 1000),
      ) ||
      !Array.isArray(pg.items) ||
      pg.items.length > 1000
    )
      throw Error("ขนาดหรือการจัดวางกระดาษไม่ถูกต้อง");
    for (const a of pg.items) {
      if (
        !["round", "square", "sticker"].includes(a.type) ||
        !positive(a.face) ||
        !positive(a.outer) ||
        a.face > a.outer ||
        !nonnegative(a.safe) ||
        a.safe * 2 > a.face ||
        !nonnegative(a.x) ||
        !nonnegative(a.y) ||
        !color(a.background) ||
        !Array.isArray(a.texts) ||
        a.texts.length > 50 ||
        typeof a.notes !== "string"
      )
        throw Error("ขนาดหรือข้อมูลชิ้นงานไม่ถูกต้อง");
      for (const t of a.texts)
        if (
          typeof t.text !== "string" ||
          t.text.length > 2000 ||
          !positive(t.size, 500) ||
          !Number.isFinite(t.x) ||
          !Number.isFinite(t.y) ||
          !Number.isFinite(t.rotation) ||
          !color(t.color) ||
          !["sans", "serif", "hand"].includes(t.font) ||
          !["normal", "bold"].includes(t.weight)
        )
          throw Error("ข้อมูลข้อความไม่ถูกต้อง");
      if (a.image) {
        const im = a.image;
        if (
          !Object.hasOwn(p.assets, im.asset) ||
          !positive(im.scale, 20) ||
          !Number.isFinite(im.dx) ||
          !Number.isFinite(im.dy) ||
          !Number.isFinite(im.rotation) ||
          !["cover", "contain"].includes(im.fit)
        )
          throw Error("ข้อมูลตำแหน่งภาพไม่ถูกต้อง");
      }
    }
    count += pg.items.length;
  }
  if (count > 10000) throw Error("รองรับไม่เกิน 10,000 ชิ้นต่อโปรเจกต์");
  for (const k of ["cut", "face", "safe", "marks"]) {
    const s = p.styles?.[k];
    if (
      !s ||
      !color(s.color) ||
      !positive(s.width, 10) ||
      !nonnegative(s.opacity, 1) ||
      !["", "2 1", "0.3 1"].includes(s.dash) ||
      !nonnegative(s.size, 100) ||
      !nonnegative(s.offset, 100) ||
      typeof s.preview !== "boolean" ||
      typeof s.export !== "boolean"
    )
      throw Error("รูปแบบเส้นไม่ถูกต้อง");
  }
  return p;
}
export function layoutSnapshot(page) {
  const a = clone(page);
  for (const i of a.items) {
    i.image = null;
    i.texts = [];
    i.background = "#ffffff";
  }
  return a;
}
export function migrate(old) {
  if (old?.version === 2) return validateProject(old);
  if (old?.version !== 1 || !old.fields) throw Error("ไม่รองรับไฟล์นี้");
  const p = newProject(),
    f = old.fields,
    u = units[f.unit] || 1,
    pg = newPage();
  const num = (k, d) => (Number.isFinite(Number(f[k])) ? Number(f[k]) * u : d);
  pg.paper = {
    width: num("width", 210),
    height: num("height", 297),
    top: num("margin", 5),
    right: num("margin", 5),
    bottom: num("margin", 5),
    left: num("margin", 5),
  };
  pg.layout.gapX = num("gapX", 2);
  pg.layout.gapY = num("gapY", 2);
  const base = newItem(f.type || "round", num("face", 68), num("diameter", 78));
  base.safe = num("safe", 3);
  base.notes = String(f.notes || "");
  pg.items = gridItems(pg, base);
  for (let i = 0; i < pg.items.length; i++) {
    const a = old.items?.[i];
    if (!a) continue;
    const b = pg.items[i];
    b.background = a.background || "#ffffff";
    if (a.caption)
      b.texts = [
        {
          text: String(a.caption),
          size: a.fontSize || 5,
          x: b.outer / 2,
          y: b.outer * 0.72,
          color: a.textColor || "#172033",
          font: "sans",
          weight: "normal",
          rotation: 0,
        },
      ];
  }
  p.pages = [pg];
  p.unit = f.unit || "mm";
  return validateProject(p);
}
