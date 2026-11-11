import { test } from "node:test";
import assert from "node:assert/strict";
import { newPage, newItem } from "../model.js";
import {
  spacingReport,
  allDesignsApplied,
  shapeClearance,
} from "../workspace-state.js";
test("spacing report distinguishes near spacing from real overlap", () => {
  const page = newPage();
  page.items = [
    { ...newItem("round", 20, 20), x: 5, y: 5 },
    { ...newItem("round", 20, 20), x: 25.5, y: 5 },
  ];
  assert.equal(spacingReport(page).overlaps, 0);
  assert.equal(spacingReport(page).close, 1);
  page.items[1].x = 24;
  assert.equal(spacingReport(page).overlaps, 1);
  page.items[1].x = 27;
  assert.equal(spacingReport(page).crowded, false);
});
test("clearance follows circle geometry rather than bounding boxes", () => {
  const a = { ...newItem("round", 20, 20), x: 0, y: 0 },
    b = { ...newItem("round", 20, 20), x: 19, y: 19 };
  assert.ok(shapeClearance(a, b) > 6);
});
test("design applied state survives normalized placement and clears after differences", () => {
  const p = newPage(),
    a = newItem("round", 40, 50),
    b = newItem("square", 100, 100);
  a.texts = [{ text: "same", x: 25, y: 30 }];
  b.texts = [{ text: "same", x: 50, y: 60 }];
  p.items = [a, b];
  p.designApplied = true;
  assert.equal(allDesignsApplied(p), true);
  b.background = "#101010";
  assert.equal(allDesignsApplied(p), false);
  b.background = a.background;
  p.designApplied = false;
  assert.equal(allDesignsApplied(p), false);
});
