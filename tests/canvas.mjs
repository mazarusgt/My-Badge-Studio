import {
  reveal,
  openDesigner,
  confirmItemDeletion,
} from "./editor-helpers.mjs";
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const data = await mkdtemp(path.join(tmpdir(), "badge-canvas-"));
const port = "5195",
  origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["server.js"], {
  env: { ...process.env, PORT: port, BADGE_DATA_DIR: data },
  stdio: "ignore",
});
let browser;
let checks = 0;
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
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.goto(origin);
  await p.locator("#sheet svg").waitFor();
  const selected = () => p.locator('#sheet [aria-pressed="true"]').count();
  const count = () => p.locator("#sheet [data-slot]").count();
  const slot = (i) => p.locator(`#sheet [data-slot="${i}"]`);
  await slot(0).click();
  await slot(2).click({ modifiers: ["Shift"] });
  check(
    "Shift+click selects exact nonadjacent items",
    (await selected()) === 2 &&
      (await slot(2).getAttribute("aria-pressed")) === "true" &&
      (await slot(1).getAttribute("aria-pressed")) === "false",
  );
  await slot(0).click({ modifiers: ["Shift"] });
  check("Shift+click toggles selection", (await selected()) === 1);
  await slot(0).click();
  await slot(2).click({ modifiers: ["Shift"] });
  await p.keyboard.press("Control+Shift+S");
  check(
    "keyboard conversion applies to both selected items",
    (await slot(0).locator(":scope > rect").count()) > 0 &&
      (await slot(2).locator(":scope > rect").count()) > 0,
  );
  check(
    "unselected item keeps circular shape",
    (await slot(1).locator(":scope > circle").count()) > 0,
  );
  await p.keyboard.press("Control+Shift+C");
  check(
    "keyboard circular conversion",
    (await slot(0).locator(":scope > circle").count()) > 0,
  );
  await p.keyboard.press("Control+d");
  check(
    "Ctrl+D duplicates the whole selection",
    (await count()) === 8 && (await selected()) === 2,
  );
  await p.keyboard.press("Delete");
  await confirmItemDeletion(p);
  check(
    "Delete removes only selected copies",
    (await count()) === 6 && (await selected()) === 0,
  );
  await p.keyboard.press("Control+z");
  check("undo restores deleted group", (await count()) === 8);
  await p.keyboard.press("Control+Shift+z");
  check("redo removes group again", (await count()) === 6);
  await reveal(p, "projectName");
  await p.locator("#projectName").fill("Delete must edit text");
  await p.keyboard.press("Control+a");
  await p.keyboard.press("Delete");
  await confirmItemDeletion(p);
  check(
    "Delete in a text field does not remove canvas items",
    (await count()) === 6,
  );
  await reveal(p, "projectName");
  await p.locator("#projectName").fill("Canvas test");
  await p.locator("#projectName").blur();
  await reveal(p, "autoArrange");
  await p.locator("#autoArrange").click();
  check(
    "auto-arrange reports success",
    (await p.locator("#status").textContent()).includes(
      "จัดเรียงชิ้นงานทั้งหมดแล้ว",
    ),
  );
  await reveal(p, "clearSelection");
  await p.locator("#clearSelection").click();
  const first = await slot(0).boundingBox(),
    second = await slot(1).boundingBox();
  await p.mouse.move(first.x - 3, first.y - 3);
  await p.mouse.down();
  await p.mouse.move(
    second.x + second.width + 2,
    Math.max(first.y + first.height, second.y + second.height) + 2,
    { steps: 15 },
  );
  await p.mouse.up();
  check(
    "drag box selects only intersecting first-row items",
    (await selected()) === 2,
  );
  await reveal(p, "batchSquare");
  await p.locator("#batchSquare").click();
  check(
    "visible batch button converts selected items",
    (await slot(0).locator(":scope > rect").count()) > 0 &&
      (await slot(1).locator(":scope > rect").count()) > 0,
  );
  await reveal(p, "preset");
  await p.selectOption("#preset", "61");
  check(
    "preset size applies to every selected item",
    (await slot(0).locator(":scope > rect").first().getAttribute("width")) ===
      "61" &&
      (await slot(1).locator(":scope > rect").first().getAttribute("width")) ===
        "61",
  );
  await reveal(p, "autoArrange");
  await p.locator("#autoArrange").click();
  await reveal(p, "moveMode");
  await p.locator("#moveMode").check();
  const transforms = await p
    .locator('#sheet [aria-pressed="true"]')
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("transform")));
  const box = await slot(0).boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down();
  await p.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2 + 10, {
    steps: 10,
  });
  await p.mouse.up();
  check(
    "move mode moves selected group together",
    (
      await p
        .locator('#sheet [aria-pressed="true"]')
        .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("transform")))
    ).every((t, i) => t !== transforms[i]),
  );
  await reveal(p, "moveMode");
  await p.locator("#moveMode").uncheck();
  const canvas = await p.locator("#canvas").boundingBox();
  await p.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  const old = await p
    .locator("#sheet")
    .evaluate((n) => n.getBoundingClientRect().width);
  await p.keyboard.down("Control");
  await p.mouse.wheel(0, -120);
  await p.keyboard.up("Control");
  await p.waitForTimeout(100);
  check(
    "Ctrl+wheel zooms canvas in",
    (await p
      .locator("#sheet")
      .evaluate((n) => n.getBoundingClientRect().width)) > old,
  );
  await reveal(p, "zoom");
  await p.selectOption("#zoom", "fit");
  check(
    "screen zoom control remains usable",
    (await p.inputValue("#zoom")) === "fit",
  );
  await reveal(p, "selectAll");
  await p.locator("#selectAll").click();
  check("select-all button selects page", (await selected()) === 6);
  await p.keyboard.press("Escape");
  check("Escape clears selection", (await selected()) === 0);
  await reveal(p, "autoArrange");
  await p.locator("#autoArrange").click();
  await reveal(p, "saveTemplate");
  await p.locator("#saveTemplate").click();
  check(
    "save template opens a labeled form",
    await p.locator("#templateSaveDialog").isVisible(),
  );
  await reveal(p, "templateName");
  await p.locator("#templateName").fill("My reusable badges");
  await reveal(p, "confirmSaveTemplate");
  await p.locator("#confirmSaveTemplate").click();
  await p.locator("[data-custom]").waitFor();
  check(
    "saved template appears immediately in library",
    (await p.locator("#customTemplates").textContent()).includes(
      "My reusable badges",
    ),
  );
  await p.locator("#libraryDialog .dialoghead button").click();
  await p.reload();
  await p.locator("#sheet svg").waitFor();
  await reveal(p, "library");
  await p.locator("#library").click();
  await p.locator("#libraryDialog[open]").waitFor();
  check(
    "template persists across reload",
    (await p.locator("#customTemplates").textContent()).includes(
      "My reusable badges",
    ),
  );
  await p.locator("[data-custom]").click();
  check(
    "saved template reopens as editable project",
    (await p.inputValue("#projectName")) === "My reusable badges" &&
      (await count()) === 6,
  );
  await reveal(p, "library");
  await p.locator("#library").click();
  await p.locator("#libraryDialog[open]").waitFor();
  await p.locator("[data-remove-template]").click();
  await p.locator("[data-custom]").waitFor({ state: "detached" });
  check(
    "deleting template refreshes open library without errors",
    (await p.locator("#libraryDialog").isVisible()) &&
      (await p.locator("[data-custom]").count()) === 0,
  );
  await p.locator("#libraryDialog .dialoghead button").click();
  await mkdir("test-results", { recursive: true });
  for (const width of [390, 768, 1024, 1440]) {
    await p.setViewportSize({ width, height: 1000 });
    check(
      `no page overflow at ${width}px`,
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  }
  await p.screenshot({
    path: "test-results/canvas-desktop.png",
    fullPage: true,
  });
  await p.setViewportSize({ width: 390, height: 844 });
  await p.screenshot({
    path: "test-results/canvas-mobile.png",
    fullPage: true,
  });
  check("no runtime errors", errors.length === 0);
  console.log(`Completed ${checks} canvas checks`);
} finally {
  await browser?.close();
  server.kill();
  await new Promise((r) => server.once("exit", r));
  await rm(data, { recursive: true, force: true });
}
