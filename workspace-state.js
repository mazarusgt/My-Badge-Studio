import { itemsIntersect } from "./model.js";
export function shapeClearance(a, b) {
  const ar = a.outer / 2,
    br = b.outer / 2,
    ax = a.x + ar,
    ay = a.y + ar,
    bx = b.x + br,
    by = b.y + br;
  if (a.type !== "square" && b.type !== "square")
    return Math.hypot(ax - bx, ay - by) - ar - br;
  if (a.type === "square" && b.type === "square") {
    const dx = Math.max(a.x - b.x - b.outer, b.x - a.x - a.outer),
      dy = Math.max(a.y - b.y - b.outer, b.y - a.y - a.outer);
    return dx > 0 || dy > 0
      ? Math.hypot(Math.max(0, dx), Math.max(0, dy))
      : Math.max(dx, dy);
  }
  const c = a.type === "square" ? b : a,
    s = a.type === "square" ? a : b,
    r = c.outer / 2;
  return (
    Math.hypot(
      c.x + r - Math.max(s.x, Math.min(c.x + r, s.x + s.outer)),
      c.y + r - Math.max(s.y, Math.min(c.y + r, s.y + s.outer)),
    ) - r
  );
}
export function spacingReport(page, minimumGap = 0.8) {
  let overlaps = 0,
    close = 0;
  for (let i = 0; i < page.items.length; i++)
    for (let j = 0; j < i; j++) {
      if (itemsIntersect(page.items[i], page.items[j])) overlaps++;
      else if (
        shapeClearance(page.items[i], page.items[j]) <
        minimumGap - 0.001
      )
        close++;
    }
  const p = page.paper,
    area = (p.width - p.left - p.right) * (p.height - p.top - p.bottom);
  const density =
    page.items.reduce(
      (sum, a) => sum + a.outer ** 2 * (a.type === "square" ? 1 : Math.PI / 4),
      0,
    ) / area;
  return {
    overlaps,
    close,
    density,
    crowded: overlaps > 0 || close > 0 || density > 0.82,
  };
}
function designKey(a) {
  return JSON.stringify({
    background: a.background,
    image: a.image,
    texts: a.texts.map((t) => ({
      ...t,
      x: Number((t.x / a.outer).toFixed(6)),
      y: Number((t.y / a.outer).toFixed(6)),
    })),
  });
}
export function allDesignsApplied(page) {
  return (
    !!page.designApplied &&
    page.items.length > 0 &&
    page.items.every((a) => designKey(a) === designKey(page.items[0]))
  );
}
