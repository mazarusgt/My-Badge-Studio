import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { reveal } from "./editor-helpers.mjs";
const data = await mkdtemp(path.join(tmpdir(), "badge-editor-"));
const origin = "http://127.0.0.1:5196";
const server = spawn(process.execPath, ["server.js"], {
  env: { ...process.env, PORT: "5196", BADGE_DATA_DIR: data },
  stdio: "ignore",
});
let browser,
  checks = 0;
const check = (label, value) => {
  assert.ok(value, label);
  console.log("PASS", label);
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
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.goto(origin);
  await p.locator("#sheet svg").waitFor();
  const slot = (i) => p.locator(`#sheet [data-slot="${i}"]`);
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
    "type choices are directly visible cards",
    await p.locator('.segmented[data-for="type"]').isVisible(),
  );
  check(
    "sidebars have independent tab navigation",
    (await p.locator("#itemSettings [role=tab]").count()) === 3 &&
      (await p.locator("#designSettings [role=tab]").count()) === 3,
  );
  await p.locator("#textPanelTab").click();
  check(
    "text tab hides photo controls",
    !(await p.locator("#image").isVisible()) &&
      (await p.locator("#caption").isVisible()),
  );
  await p.locator("#textPanelTab").focus();
  await p.keyboard.press("ArrowRight");
  check(
    "tab keyboard navigation activates next panel",
    (await p.locator("#positionPanelTab").getAttribute("aria-selected")) ===
      "true",
  );
  const first = await slot(0).boundingBox(),
    second = await slot(1).boundingBox();
  await p.mouse.move(first.x - 2, first.y - 2);
  await p.mouse.down();
  await p.mouse.move(
    second.x + second.width + 1,
    second.y + second.height + 1,
    { steps: 10 },
  );
  await p.mouse.up();
  check(
    "box selection selects two items",
    (await p.locator('#sheet [aria-pressed="true"]').count()) === 2,
  );
  const png = await p.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 120;
    c.height = 120;
    c.getContext("2d").fillRect(0, 0, 120, 120);
    return c.toDataURL().split(",")[1];
  });
  await reveal(p, "image");
  await p.setInputFiles("#image", {
    name: "group.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await p.waitForFunction(
    () => document.querySelectorAll("#sheet [data-slot] use").length === 2,
  );
  let saved = await snapshot(),
    items = saved.pages[0].items;
  check(
    "one photo is assigned to every selected item only",
    items[0].image.asset === items[1].image.asset &&
      items.slice(2).every((a) => !a.image),
  );
  await change("imageScale", 130);
  await change("imageRotation", 25);
  await change("imageX", 2);
  saved = await snapshot();
  items = saved.pages[0].items;
  check(
    "image crop transforms update the whole selection",
    items
      .slice(0, 2)
      .every(
        (a) =>
          a.image.scale === 1.3 && a.image.rotation === 25 && a.image.dx === 2,
      ),
  );
  await change("backgroundHex", "#efdbfa");
  saved = await snapshot();
  check(
    "background edits apply to both selected shapes only",
    saved.pages[0].items.slice(0, 2).every((a) => a.background === "#efdbfa") &&
      saved.pages[0].items[2].background === "#ffffff",
  );
  await reveal(p, "addText");
  await p.locator("#addText").click();
  await change("caption", "ข้อความร่วมกัน");
  await change("textSize", 6);
  await change("textRotation", 15);
  saved = await snapshot();
  check(
    "adding and editing text affects every selected item",
    saved.pages[0].items
      .slice(0, 2)
      .every(
        (a) =>
          a.texts[0].text === "ข้อความร่วมกัน" &&
          a.texts[0].size === 6 &&
          a.texts[0].rotation === 15,
      ) && saved.pages[0].items[2].texts.length === 0,
  );
  await p
    .locator('.segmented[data-for="font"] button[data-value="serif"]')
    .click();
  saved = await snapshot();
  check(
    "font segmented control updates all selected layers",
    saved.pages[0].items.slice(0, 2).every((a) => a.texts[0].font === "serif"),
  );
  await p.locator("#caption").focus();
  await p.keyboard.press("Control+Shift+Delete");
  check(
    "image-delete shortcut is ignored in text input",
    (await p.locator("#sheet use").count()) === 2,
  );
  await p.locator("#caption").blur();
  await p.keyboard.press("Control+Shift+Delete");
  check(
    "Ctrl+Shift+Delete removes images while retaining containers and text",
    (await p.locator("#sheet use").count()) === 0 &&
      (await p.locator("#sheet [data-slot]").count()) === 6 &&
      (await p.locator("#sheet text").count()) === 2,
  );
  await p.keyboard.press("Control+z");
  check(
    "one undo restores the whole image batch",
    (await p.locator("#sheet use").count()) === 2,
  );
  await slot(0).click();
  await slot(2).click({ modifiers: ["Shift"] });
  await change("textHex", "#702499");
  saved = await snapshot();
  check(
    "missing text layer is created without overwriting unselected text",
    saved.pages[0].items[2].texts[0].text === "ข้อความร่วมกัน" &&
      saved.pages[0].items[0].texts[0].color === "#702499" &&
      saved.pages[0].items[2].texts[0].color === "#702499" &&
      saved.pages[0].items[1].texts[0].color !== "#702499",
  );
  await change("notes", "batch notes");
  saved = await snapshot();
  check(
    "notes update the exact selection",
    saved.pages[0].items[0].notes === "batch notes" &&
      saved.pages[0].items[2].notes === "batch notes" &&
      saved.pages[0].items[1].notes === "",
  );
  await reveal(p, "outer");
  const before = Number(await p.inputValue("#outer"));
  const plus = p.locator("#outer").locator("..").locator("button").last();
  const buttonBox = await plus.boundingBox();
  check(
    "number steppers provide large tap targets",
    buttonBox.height >= 44 && buttonBox.width >= 36,
  );
  await plus.click();
  saved = await snapshot();
  check(
    "large plus stepper edits the batch",
    saved.pages[0].items[0].outer === before + 1 &&
      saved.pages[0].items[2].outer === before + 1,
  );
  await reveal(p, "autoArrange");
  await p.locator('[data-layout-mode="staggered"]').click();
  await p.locator("#autoArrange").click();
  saved = await snapshot();
  check(
    "staggered arrange persists mode and preserves items",
    saved.pages[0].layout.mode === "staggered" &&
      saved.pages[0].items.length === 6,
  );
  await p.locator('[data-layout-mode="grid"]').click();
  await p.locator("#autoArrange").click();
  saved = await snapshot();
  check(
    "grid arrange remains available",
    saved.pages[0].layout.mode === "grid",
  );
  const resize = async (selector, dx, dy) => {
    const b = await p.locator(selector).boundingBox();
    await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await p.mouse.down();
    await p.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, {
      steps: 10,
    });
    await p.mouse.up();
  };
  const leftBefore = (await p.locator("#itemSettings").boundingBox()).width;
  await resize(".resize-left", 45, 0);
  check(
    "left edge resizes left panel",
    (await p.locator("#itemSettings").boundingBox()).width > leftBefore + 30,
  );
  const rightBefore = (await p.locator("#designSettings").boundingBox()).width;
  await resize(".resize-right", -40, 0);
  check(
    "right edge resizes right panel",
    (await p.locator("#designSettings").boundingBox()).width > rightBefore + 25,
  );
  const topBefore = (await p.locator("#topTools").boundingBox()).height;
  await resize(".resize-top", 0, -60);
  check(
    "bottom edge resizes top panel",
    (await p.locator("#topTools").boundingBox()).height < topBefore - 40,
  );
  const prefs = await p.evaluate(() =>
    localStorage.getItem("badge-editor-panels"),
  );
  await p.reload();
  await p.locator("#sheet svg").waitFor();
  check(
    "panel sizes persist after reload",
    (await p.evaluate(() => localStorage.getItem("badge-editor-panels"))) ===
      prefs &&
      (await p.locator("#topTools").boundingBox()).height < topBefore - 40,
  );
  for (const selector of ["#itemSettings", "#designSettings", "#topTools"]) {
    await p.locator(selector + " > .panel-toggle").click();
    check(
      selector + " collapses",
      await p
        .locator(selector)
        .evaluate((n) => n.classList.contains("panel-collapsed")),
    );
    await p.locator(selector + " > .panel-toggle").click();
    check(
      selector + " expands",
      !(await p
        .locator(selector)
        .evaluate((n) => n.classList.contains("panel-collapsed"))),
    );
  }
  const hover = p.locator("#help"),
    normal = await hover.evaluate((n) => getComputedStyle(n).backgroundColor);
  await hover.hover();
  await p.waitForTimeout(200);
  check(
    "button hover visibly changes color",
    (await hover.evaluate((n) => getComputedStyle(n).backgroundColor)) !==
      normal,
  );
  await p.locator("#library").click();
  await p.locator("#libraryDialog[open]").waitFor();
  check(
    "design gallery has designs and hides layouts",
    (await p.locator("#designTemplates").isVisible()) &&
      !(await p.locator("#readyTemplates").isVisible()),
  );
  await p.locator("#layoutGalleryTab").click();
  check(
    "layout gallery shows sizes and saved layouts separately",
    (await p.locator("#readyTemplates").isVisible()) &&
      (await p.locator("#savedLayoutTemplates").isVisible()) &&
      !(await p.locator("#designTemplates").isVisible()),
  );
  await p.locator("#libraryDialog .dialoghead button").click();
  await mkdir("test-results", { recursive: true });
  await p.locator("#selectionToolsTab").click();
  await p.screenshot({
    path: "test-results/editor-desktop.png",
    fullPage: true,
  });
  for (const width of [390, 768, 1024, 1440]) {
    await p.setViewportSize({ width, height: 1000 });
    check(
      "no overflow with resized panels at " + width,
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  }
  await p.setViewportSize({ width: 390, height: 844 });
  await p.screenshot({
    path: "test-results/editor-mobile.png",
    fullPage: true,
  });
  check("no browser runtime errors", errors.length === 0);
  console.log(`Completed ${checks} editor checks`);
} finally {
  await browser?.close();
  server.kill();
  await new Promise((r) => server.once("exit", r));
  await rm(data, { recursive: true, force: true });
}
