import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdtemp, rm, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { reveal, openDesigner } from "./editor-helpers.mjs";
const data = await mkdtemp(path.join(tmpdir(), "badge-actions-"));
const origin = "http://127.0.0.1:5203";
const server = spawn(process.execPath, ["server.js"], {
  env: { ...process.env, PORT: "5203", BADGE_DATA_DIR: data },
  stdio: "ignore",
});
let browser,
  checks = 0;
const check = (name, value) => {
  assert.ok(value, name);
  console.log("PASS", name);
  checks++;
};
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(origin + "/api/health")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const p = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  p.on("dialog", (d) => d.accept());
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(origin);
  await p.locator("#sheet svg").waitFor();
  const slot = (i) => p.locator(`#sheet [data-slot="${i}"]`),
    count = () => p.locator("#sheet [data-slot]").count();
  const snapshot = async () => {
    const event = p.waitForEvent("download");
    await p.locator("#save").click();
    const d = await event;
    return JSON.parse(await readFile(await d.path(), "utf8"));
  };
  const change = async (id, value) => {
    await reveal(p, id);
    await p.locator("#" + id).fill(String(value));
    await p.locator("#" + id).dispatchEvent("change");
  };
  check(
    "obsolete arrangement buttons are absent",
    (await p.locator("#fillGrid,#pack").count()) === 0,
  );
  await p.locator("#selectAll").evaluate((n) => n.click());
  await change("face", 40);
  await change("outer", 50);
  await reveal(p, "paper");
  const before = await snapshot();
  const transforms = () =>
    p
      .locator("#sheet [data-slot]")
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("transform")));
  const initial = await transforms();
  await p.locator("#cols").fill("3");
  await p.waitForTimeout(60);
  check(
    "columns update the canvas during input before blur",
    JSON.stringify(await transforms()) !== JSON.stringify(initial),
  );
  check(
    "input preview does not create an autosave/undo mutation",
    (
      await p.evaluate(async () =>
        (await import("/storage.js")).get("autosave"),
      )
    ).pages[0].layout.cols === 0,
  );
  await p.locator("#cols").dispatchEvent("change");
  let saved = await snapshot();
  check(
    "committed grid keeps all item IDs, dimensions and artwork",
    saved.pages[0].items.length === 6 &&
      saved.pages[0].items.every(
        (a, i) =>
          a.id === before.pages[0].items[i].id &&
          a.outer === before.pages[0].items[i].outer &&
          a.background === before.pages[0].items[i].background,
      ),
  );
  await change("cols", 0);
  await p.locator("#rows").fill("4");
  await p.waitForTimeout(60);
  await p.locator("#rows").dispatchEvent("change");
  saved = await snapshot();
  check(
    "rows produce four occupied rows immediately",
    new Set(saved.pages[0].items.map((a) => a.y)).size === 4,
  );
  await change("rows", 0);
  await change("cols", 3);
  const old = await transforms();
  await p.locator("#gapX").fill("9");
  await p.waitForTimeout(60);
  check(
    "spacing previews immediately",
    JSON.stringify(await transforms()) !== JSON.stringify(old),
  );
  await p.locator("#gapX").dispatchEvent("change");
  const stable = await snapshot(),
    stablePositions = await transforms();
  await p.locator("#cols").fill("20");
  await p.waitForTimeout(60);
  check(
    "impossible grid shows inline feedback",
    await p
      .locator("#layoutFeedback")
      .evaluate((n) => n.classList.contains("invalid")),
  );
  check(
    "impossible input preserves saved and displayed positions",
    JSON.stringify(await transforms()) === JSON.stringify(stablePositions) &&
      (await snapshot()).pages[0].layout.cols === stable.pages[0].layout.cols,
  );
  await p.locator('[data-reset-setting="cols"]').click();
  check(
    "reset recovers from invalid input",
    (await p.inputValue("#cols")) === "0" &&
      !(await p
        .locator("#layoutFeedback")
        .evaluate((n) => n.classList.contains("invalid"))),
  );
  await p.locator('[data-reset-setting="gapX"]').click();
  check(
    "spacing reset restores factory 2 mm",
    (await p.inputValue("#gapX")) === "2",
  );
  await p.locator('[data-unit-for="pageUnit"] [data-unit="cm"]').click();
  await p.locator('[data-reset-setting="gapY"]').click();
  check(
    "resets respect displayed unit without changing physical default",
    (await p.inputValue("#gapY")) === "0.2" &&
      (await snapshot()).pages[0].layout.gapY === 2,
  );
  const defaultName = await p
    .locator('[data-reset-setting="pageUnit"]')
    .getAttribute("aria-label");
  check(
    "reset icons have explicit accessible names",
    defaultName.includes("คืนค่าเริ่มต้น"),
  );
  const snapshotBeforeUndo = await snapshot();
  await change("gapX", 0.5);
  await p.locator("#canvas").focus();
  await p.keyboard.press("Control+z");
  check(
    "one undo restores the entire layout change",
    (await snapshot()).pages[0].layout.gapX ===
      snapshotBeforeUndo.pages[0].layout.gapX,
  );
  await p.locator("#sizePanelTab").click();
  await p.locator('[data-reset-setting="outer"]').click();
  saved = await snapshot();
  check(
    "size reset safely restores type-specific face and cut dimensions",
    saved.pages[0].items.every((a) => a.face === 68 && a.outer === 78),
  );
  await mkdir("test-results", { recursive: true });
  await p.locator("#paperPanelTab").click();
  await p.screenshot({
    path: "test-results/live-layout-desktop.png",
    fullPage: true,
  });
  for (const width of [390, 768, 1024, 1440]) {
    await p.setViewportSize({ width, height: 1000 });
    check(
      "no overflow at " + width,
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  }
  check("no runtime errors", errors.length === 0);
  console.log(`Completed ${checks} live layout checks`);
} finally {
  await browser?.close();
  server.kill();
  await new Promise((r) => server.once("exit", r));
  await rm(data, { recursive: true, force: true });
}
