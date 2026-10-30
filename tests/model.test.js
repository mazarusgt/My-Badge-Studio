import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newProject,
  newPage,
  newItem,
  gridItems,
  packItems,
  pageWarnings,
  pageIndices,
  parseCSV,
  mergeText,
  validateProject,
  layoutSnapshot,
  migrate,
} from "../model.js";
import { renderPage, renderDXF } from "../render.js";
import { pngDPI, crc32, zip } from "../exports.js";
test("independent margins and explicit grid preserve all bounds", () => {
  const page = newPage();
  Object.assign(page.paper, { left: 11, right: 17, top: 13, bottom: 19 });
  Object.assign(page.layout, { cols: 2, rows: 3, gapX: 4, gapY: 5 });
  page.items = gridItems(page, newItem("round", 50, 60));
  assert.equal(page.items.length, 6);
  assert.equal(page.items[0].x, 11);
  assert.equal(page.items[0].y, 13);
  assert.equal(page.items[5].x, 75);
  assert.equal(page.items[5].y, 143);
  assert.deepEqual(pageWarnings(page), []);
  page.layout.cols = 4;
  assert.throws(() => gridItems(page, newItem("round", 50, 60)));
});
test("mixed layout does not resize and fails atomically", () => {
  const p = newPage();
  p.items = [
    newItem("round", 73, 83),
    newItem("square", 50, 50),
    newItem("round", 58, 70),
  ];
  packItems(p);
  assert.deepEqual(
    p.items.map((a) => a.outer),
    [83, 50, 70],
  );
  assert.deepEqual(pageWarnings(p), []);
  const old = p.items.map((a) => [a.x, a.y]);
  p.paper.height = 20;
  assert.throws(() => packItems(p));
  assert.deepEqual(
    p.items.map((a) => [a.x, a.y]),
    old,
  );
});
test("warnings detect overlap and overflow", () => {
  const p = newPage();
  p.items = [newItem(), newItem()];
  assert.match(pageWarnings(p)[0], /ทับกัน/);
  p.items[1].x = 500;
  assert.ok(pageWarnings(p).some((w) => w.includes("เกิน")));
});
test("range parser deduplicates and rejects invalid selection", () => {
  assert.deepEqual(pageIndices("1,3-5,3", 5, 0), [0, 2, 3, 4]);
  assert.deepEqual(pageIndices("current", 5, 2), [2]);
  for (const v of ["0", "6", "3-1", "bad", ""])
    assert.throws(() => pageIndices(v, 5, 0));
});
test("CSV handles Thai, quoted commas, multiline cells and merge", () => {
  const rows = parseCSV(
    '\uFEFFname,title\r\n"สมชาย, เอ","หัวหน้า\nทีม"\r\nสมหญิง,ทีมงาน\r\n',
  );
  assert.equal(rows[0].name, "สมชาย, เอ");
  assert.equal(rows[0].title, "หัวหน้า\nทีม");
  assert.equal(
    mergeText("สวัสดี {{ name }} — {{title}}", rows[1]),
    "สวัสดี สมหญิง — ทีมงาน",
  );
  assert.throws(() => parseCSV('name\n"oops'));
});
test("validation rejects malformed imports and nonfinite dimensions", () => {
  const p = newProject();
  validateProject(p);
  const bad = structuredClone(p);
  bad.pages[0].items[0].outer = NaN;
  assert.throws(() => validateProject(bad));
  const asset = structuredClone(p);
  asset.assets.bad = { data: "javascript:alert(1)", width: 10, height: 10 };
  assert.throws(() => validateProject(asset));
  const s = structuredClone(p);
  s.styles.cut.color = 'red" onclick="evil';
  assert.throws(() => validateProject(s));
});
test("layout snapshot stores physical arrangement without private artwork", () => {
  const p = newProject();
  p.pages[0].items[0].texts.push({ text: "private" });
  const result = layoutSnapshot(p.pages[0]);
  assert.equal(result.items[0].outer, 78);
  assert.deepEqual(result.items[0].texts, []);
  assert.equal(p.pages[0].items[0].texts.length, 1);
});
test("SVG physical dimensions, escaped text, and guide separation", () => {
  const p = newProject(),
    a = p.pages[0].items[0];
  a.texts = [
    {
      text: "ไทย <script>",
      x: 30,
      y: 30,
      size: 5,
      color: "#000000",
      font: "sans",
      weight: "normal",
      rotation: 0,
    },
  ];
  const result = renderPage(p, p.pages[0], { production: true });
  assert.match(result, /width="210mm" height="297mm"/);
  assert.match(result, /ไทย &lt;script&gt;/);
  assert.ok(!result.includes(p.styles.face.color));
  assert.match(renderPage(p, p.pages[0]), new RegExp(p.styles.face.color));
  assert.ok(
    !renderPage(p, p.pages[0], { production: true, art: false }).includes(
      "ไทย",
    ),
  );
  assert.match(renderDXF(p.pages[0]), /\$INSUNITS\n70\n4/);
});
test("PNG DPI uses physical pixels per metre with a valid checksum", () => {
  const input = new Uint8Array(45),
    result = pngDPI(input, 300),
    view = new DataView(result.buffer);
  assert.equal(view.getUint32(41), 11811);
  assert.equal(new TextDecoder().decode(result.slice(37, 41)), "pHYs");
  assert.equal(view.getUint32(50), crc32(result.slice(37, 50)));
});
test("ZIP builds valid uncompressed archive headers", async () => {
  const blob = await zip([
      { name: "one.svg", data: "first" },
      { name: "two.svg", data: "second" },
    ]),
    bytes = new Uint8Array(await blob.arrayBuffer()),
    view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint32(bytes.length - 22, true), 0x06054b50);
  assert.equal(view.getUint16(bytes.length - 14, true), 2);
});
test("legacy dimensions migrate in canonical mm", () => {
  const p = migrate({
    version: 1,
    fields: {
      unit: "cm",
      width: 21,
      height: 29.7,
      margin: 0.5,
      face: 5.8,
      diameter: 7,
      type: "round",
    },
  });
  assert.equal(p.pages[0].items[0].outer, 70);
  assert.equal(p.pages[0].paper.width, 210);
});
