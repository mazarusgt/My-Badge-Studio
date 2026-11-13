import { test } from "node:test";
import assert from "node:assert/strict";
import { newPage, newItem, packItems, clone, pageWarnings } from "../model.js";
function page() {
  const p = newPage();
  p.items = Array.from({ length: 6 }, () => newItem("square", 40, 40));
  return p;
}
test("explicit columns arrange existing items without recreating them", () => {
  const p = page(),
    ids = p.items.map((a) => a.id);
  Object.assign(p.layout, { cols: 3, rows: 0, axis: "cols", gapX: 4, gapY: 5 });
  packItems(p);
  assert.deepEqual(
    p.items.map((a) => a.id),
    ids,
  );
  assert.equal(p.items[2].x, 93);
  assert.equal(p.items[3].y, 50);
  assert.deepEqual(pageWarnings(p), []);
});
test("explicit rows arrange column-first using the requested number of rows", () => {
  const p = page();
  Object.assign(p.layout, { rows: 4, cols: 0, axis: "rows" });
  packItems(p);
  assert.equal(p.items[3].y, 131);
  assert.equal(p.items[4].x, 47);
  assert.equal(p.items[4].y, 5);
  assert.deepEqual(pageWarnings(p), []);
});
test("grid capacity and physical overflow fail atomically", () => {
  const p = page();
  p.layout.cols = 2;
  p.layout.rows = 2;
  const before = clone(p.items);
  assert.throws(() => packItems(p), /รองรับไม่ครบ/);
  assert.deepEqual(p.items, before);
  p.layout.cols = 10;
  p.layout.rows = 0;
  assert.throws(() => packItems(p), /เกินพื้นที่/);
  assert.deepEqual(p.items, before);
});
test("mixed-size grid preserves artwork and dimensions", () => {
  const p = page();
  p.items[1].outer = 50;
  p.items[1].face = 50;
  p.items[0].background = "#112233";
  p.items[2].texts = [{ text: "keep" }];
  p.layout.cols = 3;
  const before = p.items.map(({ x, y, ...a }) => a);
  packItems(p);
  assert.deepEqual(
    p.items.map(({ x, y, ...a }) => a),
    before,
  );
  assert.deepEqual(pageWarnings(p), []);
});
