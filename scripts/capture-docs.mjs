import { chromium } from "playwright-core";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { newProject } from "../model.js";
const root = path.resolve(import.meta.dirname, ".."),
  output = path.join(root, "docs/screenshots");
const data = await fs.mkdtemp(path.join(tmpdir(), "badge-docs-"));
const origin = "http://127.0.0.1:5205";
const server = spawn(process.execPath, ["server.js"], {
  cwd: root,
  env: { ...process.env, PORT: "5205", BADGE_DATA_DIR: data },
  stdio: ["ignore", "pipe", "pipe"],
});
let browser,
  serverError = "";
server.stderr.on("data", (b) => (serverError += b));
const hash = (data) => createHash("sha256").update(data).digest("hex");
const project = newProject();
project.name = "ตัวอย่างการจัดวาง";
const colors = [
  "#e8d7fa",
  "#d1eae1",
  "#f5e1c8",
  "#d7e5f5",
  "#f1d8e3",
  "#dedcf3",
];
for (const [i, item] of project.pages[0].items.entries()) {
  item.background = colors[i];
  item.texts = [
    {
      text: [
        "ทีมงาน",
        "MY BADGE",
        "สร้างสรรค์",
        "ออกแบบ",
        "PRINT 100%",
        "สวัสดี",
      ][i],
      size: 5,
      x: item.outer / 2,
      y: item.outer * 0.56,
      color: "#382342",
      font: "sans",
      weight: "bold",
      rotation: 0,
    },
  ];
}
try {
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
  if (!ready) throw Error("Capture server failed: " + serverError);
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    locale: "th-TH",
    timezoneId: "Asia/Bangkok",
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.goto(origin);
  await page.locator("#sheet svg").waitFor();
  await page.setInputFiles("#projectFile", {
    name: "documentation-example.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.waitForFunction(
    () => document.querySelector("#projectName").value === "ตัวอย่างการจัดวาง",
  );
  await page.waitForFunction(
    () => document.querySelector("#saveStatus").textContent !== "กำลังบันทึก…",
  );
  assert.equal(
    await page.locator("#fillGrid,#pack,#openBadgeEditor").count(),
    0,
  );
  assert.equal(
    (await page.locator("#itemSettings [data-reset-setting]").count()) > 10,
    true,
  );
  await fs.mkdir(output, { recursive: true });
  const images = [];
  async function capture(file, label, fullPage = false) {
    await page.mouse.move(0, 0);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r)),
      );
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      "Page overflow",
    );
    const bytes = await page.screenshot({
      path: path.join(output, file),
      fullPage,
      animations: "disabled",
    });
    const size = {
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    };
    images.push({
      file,
      label,
      viewport: page.viewportSize(),
      full_page: fullPage,
      ...size,
      sha256: hash(bytes),
    });
  }
  await page.locator("#paperPanelTab").click();
  await page.locator("#paperPanel").evaluate((n) => (n.scrollTop = 360));
  await page.locator("#layoutFeedback").waitFor();
  await capture("desktop.png", "แคนวาสจัดหน้า: รีเซ็ตและการจัดวางทันที");
  await page.locator("#canvas").focus();
  await page.keyboard.press("e");
  await page.locator("#badgeEditor[open]").waitFor();
  await page.locator("#badgeGrid").click();
  await capture(
    "designer-desktop.png",
    "ตัวแก้ไขดีไซน์: แถบเครื่องมือ เลเยอร์ และกริด",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await capture("designer-mobile.png", "ตัวแก้ไขดีไซน์บนมือถือ");
  await page.locator("#cancelBadgeDraft").click();
  await page.locator("#sizePanelTab").click();
  await page
    .locator("#itemSettings .tab-panel:not([hidden])")
    .evaluate((n) => (n.scrollTop = 0));
  await page.evaluate(() => scrollTo(0, 0));
  await capture(
    "mobile.png",
    "จัดหน้าบนมือถือ พร้อมหน่วยและตัวนับชิ้นงาน",
    true,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => scrollTo(0, 0));
  await page.locator("#library").click();
  await page.locator("#libraryDialog[open]").waitFor();
  await page.locator("#designGallery").evaluate((n) => (n.scrollTop = 0));
  await capture("gallery.png", "คลังเทมเพลต: ปุ่มเพิ่มและไอคอนแก้ไข/ลบ");
  assert.deepEqual(errors, [], "Browser runtime errors");
  const sourceFiles = (await fs.readdir(root)).filter((name) =>
    /\.(js|css|html)$/.test(name),
  );
  sourceFiles.push(
    "package.json",
    "scripts/capture-docs.mjs",
    ...["sans", "serif", "hand", "latin"].map(
      (n) => "assets/fonts/" + n + ".ttf",
    ),
  );
  const sourceHashes = {};
  for (const file of sourceFiles.sort())
    sourceHashes[file] = hash(await fs.readFile(path.join(root, file)));
  const manifest = {
    schema: 1,
    captured_at: new Date().toISOString(),
    source_commit: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
    browser: browser.version(),
    generator: "npm run docs:screenshots",
    fixture: "โปรเจกต์ตัวอย่าง 6 ชิ้น ไม่ใช้ข้อมูลผู้ใช้",
    source_hashes: sourceHashes,
    images,
  };
  await fs.writeFile(
    path.join(output, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log(
    `Captured ${images.length} documentation screenshots; no overflow or runtime errors.`,
  );
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    server.kill();
    await new Promise((r) => server.once("exit", r));
  }
  await fs.rm(data, { recursive: true, force: true });
}
