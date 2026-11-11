import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { reveal } from "./editor-helpers.mjs";
const data = await mkdtemp(path.join(tmpdir(), "badge-studio-")),
  origin = "http://127.0.0.1:5198";
const server = spawn(process.execPath, ["server.js"], {
  env: { ...process.env, PORT: "5198", BADGE_DATA_DIR: data },
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
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.goto(origin);
  await p.locator("#sheet svg").waitFor();
  const change = async (id, value) => {
    await reveal(p, id);
    await p.locator("#" + id).fill(String(value));
    await p.locator("#" + id).dispatchEvent("change");
  };
  const snapshot = async () => {
    const event = p.waitForEvent("download");
    await p.locator("#save").click();
    const d = await event;
    return JSON.parse(await readFile(await d.path(), "utf8"));
  };
  const openLibrary = async () => {
    await p.locator("#library").click();
    await p.locator("#libraryDialog[open]").waitFor();
  };
  const closeLibrary = () =>
    p.locator("#libraryDialog .dialoghead button").click();
  const ownDesign = () => p.locator("#customTemplates .template-card");
  const ownLayout = () => p.locator("#savedLayoutTemplates .template-card");
  check(
    "old preview header is removed",
    (await p.locator(".canvas-heading").count()) === 0,
  );
  check(
    "dark color scheme applies to controls",
    (await p.evaluate(
      () => getComputedStyle(document.documentElement).colorScheme,
    )) === "dark",
  );
  await reveal(p, "duplicateItem");
  await p.locator("#duplicateItem").click();
  check(
    "genuine overlap shows persistent alert",
    (await p.locator("#spacingWarning").isVisible()) &&
      (await p.locator("#spacingTitle").textContent()).includes("ทับกัน"),
  );
  await change("projectName", "Persistent warning");
  check(
    "unrelated status does not clear overlap alert",
    await p.locator("#spacingWarning").isVisible(),
  );
  await reveal(p, "deleteItem");
  await p.locator("#deleteItem").click();
  check(
    "removing overlapping item clears warning",
    !(await p.locator("#spacingWarning").isVisible()),
  );
  await change("gapX", 0.2);
  await change("gapY", 0.2);
  await reveal(p, "autoArrange");
  await p.locator("#autoArrange").click();
  check(
    "tight spacing gets distinct advisory",
    (await p.locator("#spacingWarning").isVisible()) &&
      (await p.locator("#spacingTitle").textContent()).includes("ชิด"),
  );
  await change("gapX", 2);
  await change("gapY", 2);
  await p.locator("#fixSpacing").click();
  check(
    "adjusting spacing clears advisory",
    !(await p.locator("#spacingWarning").isVisible()),
  );
  await p.locator('#sheet [data-slot="0"]').click();
  await p.locator("#applyAll").click();
  check(
    "apply-to-all gains persistent pressed state",
    (await p.locator("#applyAll").getAttribute("aria-pressed")) === "true",
  );
  await p.reload();
  await p.locator("#sheet svg").waitFor();
  check(
    "apply-to-all indicator survives reload",
    (await p.locator("#applyAll").getAttribute("aria-pressed")) === "true",
  );
  await change("backgroundHex", "#334455");
  check(
    "individual design differences clear applied indicator",
    (await p.locator("#applyAll").getAttribute("aria-pressed")) === "false",
  );
  await reveal(p, "itemX");
  check(
    "position controls have horizontal X and vertical Y sliders",
    (await p.locator("#itemXSlider").getAttribute("type")) === "range" &&
      (await p.locator("#itemYSlider").getAttribute("aria-orientation")) ===
        "vertical" &&
      (await p.locator("#itemX").locator("..").locator("button").count()) === 0,
  );
  await p.locator("#itemXSlider").evaluate((n) => {
    n.value = "12";
    n.dispatchEvent(new Event("input", { bubbles: true }));
  });
  check(
    "slider preview does not mutate saved project",
    (await snapshot()).pages[0].items[0].x === 5,
  );
  await p.locator("#itemXSlider").dispatchEvent("change");
  check(
    "position slider commits exact physical value",
    (await snapshot()).pages[0].items[0].x === 12,
  );
  await p.selectOption("#itemXUnit", "cm");
  check(
    "position units update range bounds",
    Math.abs(
      Number(await p.locator("#itemXSlider").getAttribute("max")) - 13.2,
    ) < 1e-9,
  );
  await p.selectOption("#itemXUnit", "mm");
  await reveal(p, "paper");
  await p.selectOption("#pageUnit", "cm");
  check(
    "one page unit updates all dimension fields",
    (await p.inputValue("#width")) === "21" &&
      (await p.inputValue("#height")) === "29.7" &&
      (await p.inputValue("#gapX")) === "0.2" &&
      !(await p.locator("#widthUnit").isVisible()),
  );
  await change("width", 22);
  check(
    "page units preserve physical output",
    (await snapshot()).pages[0].paper.width === 220,
  );
  await p.selectOption("#paper", "210,297");
  await p.selectOption("#pageUnit", "mm");
  await reveal(p, "autoArrange");
  await p.locator("#autoArrange").click();
  await p.locator('#sheet [data-slot="0"]').click();
  await p.locator('#sheet [data-slot="1"]').click({ modifiers: ["Shift"] });
  const png = await p.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 300;
    c.height = 200;
    const x = c.getContext("2d"),
      g = x.createLinearGradient(0, 0, 300, 200);
    g.addColorStop(0, "#8b4cb8");
    g.addColorStop(1, "#d9b44a");
    x.fillStyle = g;
    x.fillRect(0, 0, 300, 200);
    return c.toDataURL().split(",")[1];
  });
  const upload = async () => {
    await p.setInputFiles("#badgeImageFile", {
      name: "design-photo.png",
      mimeType: "image/png",
      buffer: Buffer.from(png, "base64"),
    });
    await p.waitForFunction(
      () =>
        document.querySelector("#badgePreview use") &&
        !document.querySelector("#saveBadgeDraft").disabled,
    );
  };
  await p.locator("#openBadgeEditor").click();
  await upload();
  check(
    "dedicated dark editor renders uploaded image",
    (await p.locator("#badgeEditor").isVisible()) &&
      (await p.locator("#badgePreview use").count()) === 1,
  );
  const stage = await p.locator("#badgePreview").boundingBox();
  await p.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await p.mouse.down();
  await p.mouse.move(
    stage.x + stage.width / 2 + 35,
    stage.y + stage.height / 2 + 20,
    { steps: 10 },
  );
  await p.mouse.up();
  check(
    "drag repositions image in physical coordinates",
    (await p.locator("#badgeXValue").textContent()) !== "0.00 mm",
  );
  await p.mouse.wheel(0, -140);
  check(
    "mouse wheel dynamically scales image",
    Number(await p.inputValue("#badgeScaleNumber")) > 100,
  );
  await p.locator("#badgeCenter").click();
  check(
    "center action resets both offsets",
    (await p.locator("#badgeXValue").textContent()) === "0.00 mm" &&
      (await p.locator("#badgeYValue").textContent()) === "0.00 mm",
  );
  await p.locator("#cancelBadgeDraft").click();
  check(
    "cancel leaves main project images unchanged",
    (await snapshot()).pages[0].items.every((a) => !a.image),
  );
  await p.locator("#openBadgeEditor").click();
  await upload();
  await p.locator("#badgeScaleNumber").fill("160");
  await p.locator("#badgeScaleNumber").dispatchEvent("input");
  await p.locator("#badgeRotationNumber").fill("30");
  await p.locator("#badgeRotationNumber").dispatchEvent("input");
  await p.locator("#badgeTextTab").click();
  await p.locator("#badgeAddText").click();
  await p.locator("#badgeCaption").fill("ดีไซน์ใหม่");
  await p.locator("#badgeCaption").dispatchEvent("input");
  await p.locator("#saveBadgeDraft").click();
  let saved = await snapshot();
  check(
    "saving modal applies precise image and text to selection atomically",
    saved.pages[0].items
      .slice(0, 2)
      .every(
        (a) =>
          a.image.scale === 1.6 &&
          a.image.rotation === 30 &&
          a.texts[0].text === "ดีไซน์ใหม่",
      ) && saved.pages[0].items.slice(2).every((a) => !a.image),
  );
  await openLibrary();
  await p.locator("#createDesignTemplate").click();
  await p.locator("#managedTemplateName").fill("ดีไซน์ทดสอบ");
  await p.locator("#managedBackground").fill("#332244");
  await p.locator("#saveTemplateDetails").click();
  await ownDesign().waitFor();
  check(
    "design gallery supports create",
    (await ownDesign().textContent()).includes("ดีไซน์ทดสอบ"),
  );
  await ownDesign().locator('[data-action="edit"]').click();
  check(
    "editing design returns to workspace with named mode",
    !(await p.locator("#libraryDialog").isVisible()) &&
      (await p.locator("#editingMode").isVisible()) &&
      (await p.locator("#editingTitle").textContent()).includes("ดีไซน์ทดสอบ"),
  );
  await change("projectName", "ดีไซน์ที่แก้ไข");
  await change("backgroundHex", "#554466");
  await p.locator("#saveTemplateEdits").click();
  await p.waitForFunction(
    () => document.querySelector("#saveTemplateEdits").disabled,
  );
  await openLibrary();
  check(
    "canvas edits save back to the existing design record",
    (await ownDesign().count()) === 1 &&
      (await ownDesign().textContent()).includes("ดีไซน์ที่แก้ไข"),
  );
  await ownDesign().locator('[data-action="metadata"]').click();
  await p.locator("#managedTemplateName").fill("ดีไซน์เปลี่ยนชื่อ");
  await p.locator("#managedText").fill("#fedcba");
  await p.locator("#saveTemplateDetails").click();
  await p.waitForFunction(
    () => !document.querySelector("#templateDetailsDialog").open,
  );
  check(
    "design supports rename and palette customization",
    (await ownDesign().textContent()).includes("ดีไซน์เปลี่ยนชื่อ"),
  );
  await closeLibrary();
  check(
    "renaming active template updates editing mode name",
    (await p.locator("#editingTitle").textContent()).includes(
      "ดีไซน์เปลี่ยนชื่อ",
    ) && (await p.inputValue("#projectName")) === "ดีไซน์เปลี่ยนชื่อ",
  );
  await p.locator("#saveTemplateEdits").click();
  await p.waitForFunction(
    () => document.querySelector("#saveTemplateEdits").disabled,
  );
  await p.locator("#finishTemplateEdits").click();
  await openLibrary();
  await ownDesign().locator('[data-action="delete"]').click();
  await ownDesign().waitFor({ state: "detached" });
  check("design supports deletion", (await ownDesign().count()) === 0);
  await p.locator("#layoutGalleryTab").click();
  await p.locator("#createLayoutTemplate").click();
  await p.locator("#managedTemplateName").fill("เลย์เอาต์ทดสอบ");
  await p.locator("#managedBackground").fill("#223344");
  await p.locator("#saveTemplateDetails").click();
  await ownLayout().waitFor();
  check(
    "layout gallery supports create",
    (await ownLayout().textContent()).includes("เลย์เอาต์ทดสอบ"),
  );
  await ownLayout().locator('[data-action="edit"]').click();
  check(
    "editing layout uses workspace with its own named mode",
    (await p.locator("#editingTitle").textContent()).includes(
      "เลย์เอาต์ทดสอบ",
    ) &&
      (await snapshot()).pages[0].items.every(
        (a) => !a.image && a.texts.length === 0,
      ),
  );
  await change("gapX", 4);
  await p.locator("#saveTemplateEdits").click();
  await p.waitForFunction(
    () => document.querySelector("#saveTemplateEdits").disabled,
  );
  await openLibrary();
  await p.locator("#layoutGalleryTab").click();
  await ownLayout().locator('[data-action="metadata"]').click();
  await p.locator("#managedTemplateName").fill("เลย์เอาต์เปลี่ยนชื่อ");
  await p.locator("#managedLine").fill("#ddbbff");
  await p.locator("#saveTemplateDetails").click();
  await p.waitForFunction(
    () => !document.querySelector("#templateDetailsDialog").open,
  );
  await ownLayout().locator('[data-action="edit"]').click();
  saved = await snapshot();
  check(
    "layout updates, rename, and colors persist when reopened",
    saved.pages[0].layout.gapX === 4 &&
      saved.styles.cut.color === "#ddbbff" &&
      saved.pages[0].items[0].background === "#223344",
  );
  await p.locator("#finishTemplateEdits").click();
  await openLibrary();
  await p.locator("#layoutGalleryTab").click();
  await ownLayout().locator('[data-action="delete"]').click();
  await ownLayout().waitFor({ state: "detached" });
  check("layout supports deletion", (await ownLayout().count()) === 0);
  await p.locator("#designGalleryTab").click();
  const count = await p.locator("#designTemplates .template-card").count();
  await p.locator('#designTemplates [data-action="delete"]').first().click();
  await p.waitForFunction(
    (n) =>
      document.querySelectorAll("#designTemplates .template-card").length === n,
    count - 1,
  );
  await closeLibrary();
  await p.reload();
  await p.locator("#sheet svg").waitFor();
  await openLibrary();
  check(
    "deleted built-in templates do not reappear after reload",
    (await p.locator("#designTemplates .template-card").count()) === count - 1,
  );
  await closeLibrary();
  await mkdir("test-results", { recursive: true });
  await reveal(p, "paper");
  await p.screenshot({
    path: "test-results/studio-page-setup.png",
    fullPage: true,
  });
  await p.locator("#openBadgeEditor").click();
  await upload();
  await p.mouse.move(100, 80);
  await p.screenshot({ path: "test-results/studio-badge-editor.png" });
  await p.locator("#cancelBadgeDraft").click();
  for (const width of [390, 768, 1024, 1440]) {
    await p.setViewportSize({ width, height: 1000 });
    check(
      "dark studio has no overflow at " + width,
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  }
  await p.setViewportSize({ width: 390, height: 844 });
  await p.locator("#openBadgeEditor").click();
  check(
    "dedicated editor fits mobile width",
    await p
      .locator("#badgeEditor")
      .evaluate((n) => n.getBoundingClientRect().width <= innerWidth),
  );
  await p.screenshot({
    path: "test-results/studio-badge-mobile.png",
    fullPage: true,
  });
  await p.locator("#cancelBadgeDraft").click();
  check("no runtime errors", errors.length === 0);
  console.log(`Completed ${checks} studio checks`);
} finally {
  await browser?.close();
  server.kill();
  await new Promise((r) => server.once("exit", r));
  await rm(data, { recursive: true, force: true });
}
