import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdtemp, rm, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { reveal, openDesigner } from "./editor-helpers.mjs";
const data = await mkdtemp(path.join(tmpdir(), "badge-actions-"));
const origin = "http://127.0.0.1:5201";
const server = spawn(process.execPath, ["server.js"], {
  env: { ...process.env, PORT: "5201", BADGE_DATA_DIR: data },
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
  await slot(0).click();
  check(
    "item click exposes exactly three direct icon actions",
    (await p.locator("#canvasItemActions").isVisible()) &&
      (await p.locator("#canvasItemActions button").count()) === 3,
  );
  check(
    "popup stays outside neighboring canvas items",
    await p.locator("#canvasItemActions").evaluate((menu) => {
      const r = menu.getBoundingClientRect();
      return [...document.querySelectorAll("#sheet [data-slot]")].every((n) => {
        const b = n.getBoundingClientRect();
        return (
          r.right <= b.left ||
          r.left >= b.right ||
          r.bottom <= b.top ||
          r.top >= b.bottom
        );
      });
    }),
  );
  check(
    "redundant editor and top duplicate buttons are removed",
    (await p.locator("#openBadgeEditor,#duplicateSelected").count()) === 0,
  );
  await p.locator("#canvasDuplicateItem").click();
  check("popup duplicate preserves quick-copy behavior", (await count()) === 7);
  await slot(6).click();
  await p.locator("#canvasDeleteItem").click();
  check(
    "delete always opens a named confirmation",
    (await p.locator("#deleteItemsDialog").isVisible()) &&
      (await p.locator("#deleteItemsMessage").textContent()).includes(
        "เข็มกลัด 1",
      ),
  );
  await p.locator("#cancelDeleteItems").click();
  check("cancel delete preserves item", (await count()) === 7);
  await p.locator("#canvas").focus();
  await p.keyboard.press("Delete");
  check(
    "keyboard delete also requires confirmation",
    await p.locator("#deleteItemsDialog").isVisible(),
  );
  await p.keyboard.press("Escape");
  check("Escape cancels deletion", (await count()) === 7);
  await slot(6).click();
  await p.locator("#canvasDeleteItem").click();
  await p.locator("#confirmDeleteItems").click();
  check("confirmed delete removes only selected item", (await count()) === 6);
  check(
    "footer uses a boxed page counter and no disclaimer",
    (await p.locator("#count").getAttribute("class")) === "item-counter" &&
      !(await p.locator(".workspace > footer").textContent()).includes(
        "ขนาดบนจอ",
      ),
  );
  await slot(0).click();
  await slot(1).click({ modifiers: ["Shift"] });
  const image = await p.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 240;
    c.height = 180;
    const x = c.getContext("2d");
    x.fillStyle = "#9971c2";
    x.fillRect(0, 0, 240, 180);
    return c.toDataURL().split(",")[1];
  });
  await reveal(p, "image");
  await p.setInputFiles("#image", {
    name: "resets.png",
    mimeType: "image/png",
    buffer: Buffer.from(image, "base64"),
  });
  await p.waitForFunction(
    () => document.querySelectorAll("#sheet use").length === 2,
  );
  await change("imageScale", 140);
  await change("imageRotation", 20);
  await change("imageX", 3);
  await change("imageY", 4);
  await openDesigner(p);
  await p.locator("#badgeScaleNumber").fill("175");
  await p.locator("#badgeScaleNumber").dispatchEvent("input");
  await p.locator("#badgeScaleReset").click();
  check(
    "scale reset returns to opening value",
    (await p.inputValue("#badgeScaleNumber")) === "140",
  );
  await p.locator("#badgeRotationNumber").fill("80");
  await p.locator("#badgeRotationNumber").dispatchEvent("input");
  await p.locator("#badgeRotationReset").click();
  check(
    "rotation reset returns to opening value",
    (await p.inputValue("#badgeRotationNumber")) === "20",
  );
  for (const axis of ["X", "Y"]) {
    await p.locator("#badge" + axis).fill("9");
    await p.locator("#badge" + axis).dispatchEvent("input");
    await p.locator("#badge" + axis + "Reset").click();
  }
  check(
    "X/Y resets restore original offsets",
    (await p.inputValue("#badgeX")) === "3" &&
      (await p.inputValue("#badgeY")) === "4",
  );
  await p.locator("#badgeGrid").click();
  check(
    "grid toggle is visual and explicitly pressed",
    (await p.locator("#badgeGrid").getAttribute("aria-pressed")) === "true" &&
      (await p
        .locator("#badgePreview")
        .evaluate((n) => n.classList.contains("alignment-grid"))),
  );
  await p.locator("#badgeTemplateTab").click();
  await p.locator(".designer-template").first().waitFor();
  check(
    "previously saved design templates are available inside designer",
    (await p.locator(".designer-template").count()) > 0,
  );
  await p.locator(".designer-template").first().click();
  await p.locator("#badgeTextTab").click();
  await p.locator("#badgeAddText").click();
  await p.locator("#badgeFont").selectOption("serif");
  await p.locator("#badgeWeight").selectOption("bold");
  await p.locator("#badgeLayersTab").click();
  check(
    "layer manager lists background and text layers",
    (await p.locator(".designer-layer").count()) === 3,
  );
  await p
    .getByRole("button", { name: "เลื่อนข้อความลง", exact: true })
    .first()
    .click();
  await p.locator("#saveBadgeDraft").click();
  await p.locator("#badgeEditor").waitFor({ state: "hidden" });
  let saved = await snapshot();
  check(
    "layer reordering and text properties persist for selected group",
    saved.pages[0].items
      .slice(0, 2)
      .every(
        (a) =>
          a.texts[0].text === "ข้อความใหม่" &&
          a.texts[0].font === "serif" &&
          a.texts[0].weight === "bold",
      ),
  );
  await p.locator("#library").click();
  await p.locator("#libraryDialog[open]").waitFor();
  check(
    "gallery edit/delete buttons use labeled icons without text",
    (await p
      .locator('#designTemplates [data-action="edit"]')
      .first()
      .textContent()) === "" &&
      (await p
        .locator('#designTemplates [data-action="edit"]')
        .first()
        .getAttribute("aria-label")),
  );
  check(
    "gallery no longer separates name/color into another action",
    (await p.locator('[data-action="metadata"]').count()) === 0,
  );
  check(
    "add buttons are next to section titles",
    (await p
      .locator("#createDesignTemplate")
      .locator("..")
      .getAttribute("class")) === "gallery-heading" &&
      (await p
        .locator("#createLayoutTemplate")
        .locator("..")
        .getAttribute("class")) === "gallery-heading",
  );
  await p.locator("#createDesignTemplate").click();
  await p.locator("#managedTemplateName").fill("ดีไซน์รวมขั้นตอน");
  await p.locator("#saveTemplateDetails").click();
  await p.locator("#customTemplates .template-card").waitFor();
  await p.locator('#customTemplates [data-action="edit"]').click();
  await p.locator("#badgeEditor[open]").waitFor();
  check(
    "design edit opens focused designer with integrated name",
    await p.locator("#badgeNameField").isVisible(),
  );
  await p.locator("#badgeDesignName").fill("แก้ไขชื่อในดีไซน์");
  await p.locator("#badgeColorTab").click();
  await p.locator("#badgeBackground").fill("#443355");
  await p.locator("#badgeBackground").dispatchEvent("input");
  await p.locator("#saveBadgeDraft").click();
  await p.locator("#badgeEditor").waitFor({ state: "hidden" });
  await p.locator("#library").click();
  await p.locator("#libraryDialog[open]").waitFor();
  check(
    "integrated name/color save updates the same template record",
    (await p.locator("#customTemplates .template-card").count()) === 1 &&
      (await p.locator("#customTemplates").textContent()).includes(
        "แก้ไขชื่อในดีไซน์",
      ),
  );
  await p.locator("#libraryDialog .dialoghead button").click();
  await reveal(p, "paper");
  await p.locator('[data-unit-for="pageUnit"] [data-unit="cm"]').click();
  check(
    "unit picker applies globally without an Off option",
    (await p.inputValue("#unit")) === "cm" &&
      (await p.inputValue("#faceUnit")) === "cm" &&
      (await p.inputValue("#width")) === "21" &&
      (await p.locator('[data-unit-for="pageUnit"] button').count()) === 3,
  );
  check(
    "grid captions use four Flaticon icons",
    (await p.locator(".page-grid .property-caption > svg").count()) === 4,
  );
  await mkdir("test-results", { recursive: true });
  await p.locator("#library").click();
  await p.locator("#libraryDialog[open]").waitFor();
  await p.screenshot({ path: "test-results/focused-gallery.png" });
  await p.locator("#libraryDialog .dialoghead button").click();
  await openDesigner(p);
  await p.locator("#badgeTextTab").click();
  check(
    "designer position and text units follow global picker",
    (await p.locator("#badgeTextSizeLabel").textContent()).includes("(cm)"),
  );
  await p.locator("#badgeLayersTab").click();
  await p.screenshot({ path: "test-results/focused-designer.png" });
  await p.setViewportSize({ width: 390, height: 844 });
  check(
    "focused designer fits mobile width",
    await p
      .locator("#badgeEditor")
      .evaluate((n) => n.scrollWidth <= n.clientWidth),
  );
  await p.screenshot({
    path: "test-results/focused-mobile.png",
    fullPage: true,
  });
  await p.locator("#cancelBadgeDraft").click();
  check("no runtime errors", errors.length === 0);
  console.log(`Completed ${checks} interaction checks`);
} finally {
  await browser?.close();
  server.kill();
  await new Promise((r) => server.once("exit", r));
  await rm(data, { recursive: true, force: true });
}
