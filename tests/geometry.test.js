import { test } from "node:test";
import assert from "node:assert/strict";
import { convert, arrange } from "../geometry.js";
test("physical units remain exact", () => {
  assert.equal(convert(1, "inch", "mm"), 25.4);
  assert.equal(convert(25.4, "mm", "cm"), 2.54);
});
test("layout respects cut diameter and margins", () => {
  const options = {
    width: 210,
    height: 297,
    diameter: 70,
    gapX: 2,
    gapY: 2,
    margin: 5,
  };
  const slots = arrange(options);
  assert.equal(slots.length, 8);
  for (const s of slots) {
    assert.ok(s.x >= 5 && s.y >= 5);
    assert.ok(s.x + 70 <= 205 && s.y + 70 <= 292);
  }
});
test("oversized items do not shrink", () =>
  assert.deepEqual(
    arrange({
      width: 50,
      height: 50,
      diameter: 70,
      gapX: 0,
      gapY: 0,
      margin: 0,
    }),
    [],
  ));
test("invalid geometry rejected", () =>
  assert.throws(() =>
    arrange({
      width: 210,
      height: 297,
      diameter: 0,
      gapX: 0,
      gapY: 0,
      margin: 5,
    }),
  ));
