import {
  reveal,
  openDesigner,
  confirmItemDeletion,
} from "./editor-helpers.mjs";
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
const testData = await fs.mkdtemp(path.join(tmpdir(), "badge-e2e-")),
  testPort = process.env.TEST_PORT || "5193";
const origin = process.env.TEST_ORIGIN || `http://127.0.0.1:${testPort}`,
  dir = "test-results";
await fs.mkdir(dir, { recursive: true });
let child;
if (!process.env.TEST_ORIGIN) {
  child = spawn(process.execPath, ["server.js"], {
    env: { ...process.env, PORT: testPort, BADGE_DATA_DIR: testData },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", (b) => process.stderr.write(b));
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(origin + "/api/health")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) {
    child.kill();
    throw Error("Test server did not start");
  }
}
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  }),
  page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) =>
  d.type() === "prompt" ? d.accept("เลย์เอาต์ทดสอบ") : d.accept(),
);
let checks = 0;
const check = (name, fn) => {
  assert.ok(fn, name);
  checks++;
  console.log("PASS", name);
};
async function change(id, value) {
  await page.locator("#" + id).evaluate((input) => {
    for (
      let group = input.closest("details");
      group;
      group = group.parentElement.closest("details")
    )
      group.open = true;
  });
  await reveal(page, id);
  await page.locator("#" + id).fill(String(value));
  await page.locator("#" + id).dispatchEvent("change");
}
async function download(action, name) {
  const event = page.waitForEvent("download", { timeout: 60000 });
  await action();
  const d = await event;
  await d.saveAs(`${dir}/${name || d.suggestedFilename()}`);
  return d;
}
try {
  await page.goto(origin);
  await page.locator("#sheet svg").waitFor();
  check(
    "initial A4 page rendered",
    (await page.locator("#sheet svg").getAttribute("width")) === "210mm",
  );
  check(
    "advanced image controls start collapsed",
    (await page.locator(".image-adjustments").getAttribute("open")) === null,
  );
  await page.locator('.workspace-nav a[href="#paperSettings"]').click();
  check(
    "paper shortcut reveals settings",
    await page.locator("#paper").isVisible(),
  );
  await reveal(page, "preset");
  await page.selectOption("#preset", "73");
  check("73 mm preset", (await page.inputValue("#face")) === "73");
  await reveal(page, "unit");
  await page.selectOption("#unit", "inch");
  check(
    "inch conversion leaves physical 83 mm cut",
    Math.abs(Number(await page.inputValue("#outer")) - 83 / 25.4) < 1e-9,
  );
  await reveal(page, "unit");
  await page.selectOption("#unit", "mm");
  await reveal(page, "faceUnit");
  await page.selectOption("#faceUnit", "cm");
  check("per-field cm conversion", (await page.inputValue("#face")) === "7.3");
  await reveal(page, "faceUnit");
  await page.selectOption("#faceUnit", "mm");
  await reveal(page, "autoArrange");
  await page.click("#autoArrange");
  await reveal(page, "addText");
  await page.click("#addText");
  await change("caption", "สวัสดี {{name}}");
  await reveal(page, "addText");
  await page.click("#addText");
  await change("caption", "ทีมงาน");
  await change("textSize", 4);
  await change("textY", 65);
  check(
    "multiple text layers render",
    (await page.locator('#sheet [data-slot="0"] text').count()) === 2,
  );
  // Generate a real high-resolution sample, not an upscaled thumbnail.
  const image = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 1200;
    c.height = 800;
    const x = c.getContext("2d");
    x.fillStyle = "#cde8f1";
    x.fillRect(0, 0, 1200, 800);
    x.fillStyle = "#d56377";
    x.fillRect(100, 100, 500, 500);
    return c.toDataURL("image/png").split(",")[1];
  });
  await reveal(page, "image");
  await page.setInputFiles("#image", {
    name: "sample.png",
    mimeType: "image/png",
    buffer: Buffer.from(image, "base64"),
  });
  await page.waitForFunction(() =>
    document.querySelector("#sheet [data-slot] use"),
  );
  check(
    "original image dimensions retained",
    (await page.locator("#imageQuality").textContent()).includes("1200 × 800"),
  );
  await change("imageX", 2);
  await change("imageScale", 110);
  check(
    "image crop positioning applied",
    (
      await page
        .locator('#sheet [data-slot="0"] use')
        .locator("..")
        .getAttribute("transform")
    ).includes("43.5"),
  );
  await reveal(page, "saveLayout");
  await page.click("#saveLayout");
  await reveal(page, "layouts");
  await page.selectOption("#layouts", "0");
  await reveal(page, "layoutTarget");
  await page.selectOption("#layoutTarget", "new");
  await reveal(page, "loadLayout");
  await page.click("#loadLayout");
  check(
    "saved layout loaded on a new page",
    (await page.locator("#pageSelect option").count()) === 2,
  );
  await page.locator('#sheet [data-slot="5"]').click();
  await reveal(page, "type");
  await page.selectOption("#type", "square");
  await reveal(page, "preset");
  await page.selectOption("#preset", "50");
  await reveal(page, "autoArrange");
  await page.click("#autoArrange");
  check(
    "mixed sizes fit without changing 50 mm item",
    (await page.inputValue("#outer")) === "50",
  );
  await reveal(page, "undo");
  await page.click("#undo");
  await reveal(page, "redo");
  await page.click("#redo");
  check(
    "undo/redo retain selected size",
    (await page.inputValue("#outer")) === "50",
  );
  await reveal(page, "prevPage");
  await page.click("#prevPage");
  await reveal(page, "duplicatePage");
  await page.click("#duplicatePage");
  check(
    "page duplication",
    (await page.locator("#pageSelect option").count()) === 3,
  );
  await reveal(page, "deletePage");
  await page.click("#deletePage");
  check(
    "page deletion",
    (await page.locator("#pageSelect option").count()) === 2,
  );
  await reveal(page, "prevPage");
  await page.click("#prevPage");
  await reveal(page, "textLayer");
  await page.selectOption("#textLayer", "0");
  await change("caption", "สวัสดี {{name}}");
  await reveal(page, "bulk");
  await page.click("#bulk");
  await page.fill(
    "#csvText",
    "name,title,image\nสมชาย,ทีมงาน,sample.png\nสมหญิง,ผู้จัดงาน,sample.png",
  );
  await reveal(page, "applyBulk");
  await page.click("#applyBulk");
  check(
    "CSV adds pages",
    (await page.locator("#pageSelect option").count()) === 3,
  );
  check(
    "Thai mail merge text visible",
    (await page.locator("#sheet").textContent()).includes("สมชาย"),
  );
  await download(() => page.click("#save"), "project.json");
  const project = JSON.parse(await fs.readFile(`${dir}/project.json`, "utf8"));
  check(
    "project saves original image exactly",
    Object.values(project.assets)[0].data.endsWith(image),
  );
  check(
    "project has mixed sizes and multiple pages",
    project.pages.length === 3 &&
      project.pages[1].items.some((a) => a.type === "square"),
  );
  await page.reload();
  await page.locator("#sheet svg").waitFor();
  check(
    "autosaved project restored",
    (await page.locator("#pageSelect option").count()) === 3,
  );
  await reveal(page, "projectFile");
  await page.setInputFiles("#projectFile", `${dir}/project.json`);
  await page.waitForFunction(
    () => document.querySelector("#status").textContent === "เปิดโปรเจกต์แล้ว",
  );
  check(
    "downloaded JSON restores original image",
    (await page.locator("#sheet [data-slot] use").count()) === 1,
  );
  await page.locator('.workspace-nav a[href="#paperSettings"]').click();
  await reveal(page, "pageSelect");
  await page.selectOption("#pageSelect", "2");
  await reveal(page, "paper");
  await page.selectOption("#paper", "215.9,279.4");
  await reveal(page, "export");
  await page.click("#export");
  await reveal(page, "exportPages");
  await page.selectOption("#exportPages", "all");
  await reveal(page, "exportFormat");
  await page.selectOption("#exportFormat", "svg");
  await download(() => page.click("#doExport"), "pages.zip");
  check(
    "multi-page SVG ZIP downloaded",
    (await fs.stat(`${dir}/pages.zip`)).size > 1000,
  );
  await reveal(page, "exportPages");
  await page.selectOption("#exportPages", "current");
  await reveal(page, "exportFormat");
  await page.selectOption("#exportFormat", "png");
  await change("dpi", 150);
  await download(() => page.click("#doExport"), "sheet.png");
  const png = await fs.readFile(`${dir}/sheet.png`);
  check(
    "PNG contains physical resolution metadata",
    png.includes(Buffer.from("pHYs")),
  );
  await reveal(page, "exportFormat");
  await page.selectOption("#exportFormat", "pdf");
  await reveal(page, "exportPages");
  await page.selectOption("#exportPages", "all");
  await download(() => page.click("#doExport"), "project.pdf");
  const pdf = await PDFDocument.load(await fs.readFile(`${dir}/project.pdf`));
  check("PDF contains all requested pages", pdf.getPageCount() === 3);
  check(
    "PDF has accurate A4 width",
    Math.abs(pdf.getPage(0).getWidth() - (210 / 25.4) * 72) < 0.00001,
  );
  check(
    "PDF preserves mixed paper sizes",
    Math.abs(pdf.getPage(2).getWidth() - 612) < 0.00001 &&
      Math.abs(pdf.getPage(2).getHeight() - 792) < 0.00001,
  );
  await reveal(page, "exportFormat");
  await page.selectOption("#exportFormat", "dxf");
  await reveal(page, "exportPages");
  await page.selectOption("#exportPages", "current");
  await download(() => page.click("#doExport"), "cut.dxf");
  check(
    "DXF identifies millimetres",
    (await fs.readFile(`${dir}/cut.dxf`, "utf8")).includes("$INSUNITS\n70\n4"),
  );
  await reveal(page, "exportFormat");
  await page.selectOption("#exportFormat", "print");
  await reveal(page, "exportPages");
  await page.selectOption("#exportPages", "all");
  await page.evaluate(() => {
    window.print = () => {
      window.__printed = true;
    };
  });
  await reveal(page, "doExport");
  await page.click("#doExport");
  await page.waitForFunction(() => window.__printed === true);
  check(
    "direct print prepares every page",
    (await page.locator("#printSheet svg").count()) === 3,
  );
  check(
    "print SVG identifiers are unique across pages",
    await page.evaluate(() => {
      const ids = [...document.querySelectorAll("#printSheet [id]")].map(
        (n) => n.id,
      );
      return new Set(ids).size === ids.length;
    }),
  );
  await page.locator("#exportDialog .dialoghead button").click();
  await reveal(page, "account");
  await page.click("#account");
  const suffix = Date.now();
  await reveal(page, "username");
  await page.fill("#username", `test_${suffix}`);
  await reveal(page, "password");
  await page.fill("#password", "test-password-123");
  await reveal(page, "register");
  await page.click("#register");
  await page.waitForFunction(() => !document.querySelector("#signedIn").hidden);
  await reveal(page, "serverSave");
  await page.click("#serverSave");
  await page.locator("[data-server-open]").waitFor();
  check(
    "account project saved and listed",
    (await page.locator("[data-server-open]").count()) === 1,
  );
  await page.click("[data-server-open]");
  await page.waitForFunction(
    () => !document.querySelector("#accountDialog").open,
  );
  check(
    "account project can be reopened",
    !(await page.locator("#accountDialog").isVisible()),
  );
  const savedProjects = await (
    await context.request.get(origin + "/api/projects")
  ).json();
  const other = await browser.newContext();
  const anon = await other.request.get(origin + "/api/projects");
  check("anonymous projects access denied", anon.status() === 401);
  const blocked = await other.request.post(origin + "/api/register", {
    headers: { Origin: "https://evil.invalid" },
    data: { username: "attacker", password: "test-password-123" },
  });
  check("cross-origin writes denied", blocked.status() === 403);
  const reg = await other.request.post(origin + "/api/register", {
    data: { username: `other_${suffix}`, password: "another-test-password" },
  });
  check("second independent account created", reg.ok());
  const isolated = await other.request.get(
    origin + "/api/projects/" + savedProjects[0].id,
  );
  check("other account cannot read private project", isolated.status() === 404);
  const overwrite = await other.request.put(
    origin + "/api/projects/" + savedProjects[0].id,
    { data: project },
  );
  check(
    "other account cannot overwrite private project",
    overwrite.status() === 409,
  );
  await other.close();
  await page.screenshot({ path: `${dir}/desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${dir}/mobile.png`, fullPage: true });
  check(
    "mobile has no horizontal page overflow",
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  check("no browser runtime errors", errors.length === 0);
  await context.request.post(origin + "/api/logout");
  check(
    "logout invalidates session",
    (await context.request.get(origin + "/api/projects")).status() === 401,
  );
  console.log(`Completed ${checks} browser checks`);
} catch (e) {
  console.log(
    "EXPORT STATUS",
    await page.locator("#exportStatus").textContent(),
  );
  console.log("BROWSER ERRORS", errors);
  await page.screenshot({ path: `${dir}/failure.png`, fullPage: true });
  throw e;
} finally {
  await browser.close();
  if (child) {
    child.kill("SIGTERM");
    await new Promise((r) => child.once("exit", r));
  }
  await fs.rm(testData, { recursive: true, force: true });
}
