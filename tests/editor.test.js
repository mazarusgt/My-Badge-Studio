import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newItem,
  newPage,
  gridItems,
  packItems,
  itemsIntersect,
  pageWarnings,
  clone,
} from "../model.js";
import { ensureTextLayer, setBatchProperty } from "../batch.js";
test("round bounds can overlap without geometric collision", () => {
  const a = { ...newItem("round", 20, 20), x: 0, y: 0 },
    b = { ...newItem("round", 20, 20), x: 19, y: 19 };
  assert.equal(itemsIntersect(a, b), false);
  b.x = 14;
  b.y = 14;
  assert.equal(itemsIntersect(a, b), true);
});
test("contact tolerance is stable for circles and squares", () => {
  for (const type of ["round", "square"]) {
    const a = { ...newItem(type, 20, 20), x: 0, y: 0 },
      b = { ...newItem(type, 20, 20), x: 20, y: 0 };
    assert.equal(itemsIntersect(a, b), false);
    b.x = 19.9995;
    assert.equal(itemsIntersect(a, b), false);
    b.x = 19.99;
    assert.equal(itemsIntersect(a, b), true);
  }
});
test("circle-square collision uses closest point, symmetrically", () => {
  const a = { ...newItem("round", 20, 20), x: 0, y: 0 },
    b = { ...newItem("square", 20, 20), x: 18, y: 18 };
  assert.equal(itemsIntersect(a, b), false);
  assert.equal(itemsIntersect(b, a), false);
  b.x = 16;
  b.y = 16;
  assert.equal(itemsIntersect(a, b), true);
  assert.equal(itemsIntersect(b, a), true);
});
test("staggered layout matches alternate column reference without overlaps", () => {
  const page = newPage();
  page.layout.mode = "staggered";
  page.items = gridItems(page, newItem("round", 58, 70));
  assert.equal(page.items.length, 11);
  assert.deepEqual(pageWarnings(page), []);
  const columns = [...new Set(page.items.map((a) => a.x))];
  assert.equal(columns.length, 3);
  assert.equal(
    page.items.find((a) => a.x === columns[1]).y,
    page.paper.top + 36,
  );
  const original = page.items.map((a) => ({ id: a.id, outer: a.outer }));
  packItems(page);
  assert.deepEqual(pageWarnings(page), []);
  assert.deepEqual(
    page.items.map((a) => ({ id: a.id, outer: a.outer })),
    original,
  );
});
test("staggered mixed shapes remain separated and failure leaves all positions intact", () => {
  const page = newPage();
  page.layout.mode = "staggered";
  page.items = Array.from({ length: 4 }, (_, i) =>
    newItem(i % 2 ? "square" : "round", 50, 50),
  );
  packItems(page);
  assert.deepEqual(pageWarnings(page), []);
  page.items.push(
    ...Array.from({ length: 100 }, () => newItem("round", 50, 50)),
  );
  const before = clone(page.items);
  assert.throws(() => packItems(page));
  assert.deepEqual(page.items, before);
});
test("batch properties clone data and missing text layers scale from source", () => {
  const a = newItem("round", 40, 50),
    b = newItem("square", 100, 100),
    source = {
      text: "ไทย",
      x: 25,
      y: 30,
      size: 4,
      color: "#000000",
      font: "sans",
      weight: "normal",
      rotation: 0,
    };
  setBatchProperty([a, b], "image", { asset: "test", scale: 1 });
  a.image.scale = 2;
  assert.equal(b.image.scale, 1);
  const layer = ensureTextLayer(b, 1, source, 50);
  assert.equal(layer.x, 50);
  assert.equal(layer.y, 60);
  assert.equal(layer.text, "ไทย");
  assert.equal(b.texts.length, 2);
  layer.text = "changed";
  assert.equal(source.text, "ไทย");
});
