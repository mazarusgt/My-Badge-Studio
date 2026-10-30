import { chromium } from "playwright-core";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
const errors = [],
  requests = [];
page.on("pageerror", (e) => {
  errors.push(e.message);
  console.log("BROWSER ERROR", e.message);
});
page.on("request", (r) => {
  if (/^https?:/.test(r.url())) requests.push(r.url());
});
page.on("dialog", (d) => d.accept("ไฟล์เดียวทดสอบ"));
let checks = 0;
const check = (name, passed) => {
  assert.ok(passed, name);
  checks++;
  console.log("PASS", name);
};
const change = async (id, value) => {
  await page.locator("#" + id).fill(value);
  await page.locator("#" + id).dispatchEvent("change");
};
const html = await fs.readFile("portable/My-Badge-Studio.html");
const server = http.createServer((req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(html);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const localURL = `http://127.0.0.1:${server.address().port}/`;
try {
  await page.goto(localURL);
  await context.setOffline(true);
  await page.locator("#sheet svg").waitFor({ timeout: 10000 });
  check(
    "single HTML renders as a self-contained document",
    (await page.locator("#sheet [data-slot]").count()) > 0,
  );
  check(
    "server account clearly disabled",
    await page.locator("#account").isDisabled(),
  );
  await page.selectOption("#preset", "73");
  await page.click("#fillGrid");
  await page.click("#addText");
  await change("caption", "เปิดไฟล์เดียวได้");
  check(
    "Thai text rendered",
    await page
      .locator("#sheet")
      .textContent()
      .then((s) => s.includes("เปิดไฟล์เดียวได้")),
  );
  const image = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 800;
    c.height = 600;
    c.getContext("2d").fillRect(0, 0, 800, 600);
    return c.toDataURL().split(",")[1];
  });
  await page.setInputFiles("#image", {
    name: "portable.png",
    mimeType: "image/png",
    buffer: Buffer.from(image, "base64"),
  });
  await page.waitForFunction(() =>
    document.querySelector("#sheet [data-slot] use"),
  );
  check(
    "image import works without server",
    (await page.locator("#imageQuality").textContent()).includes("800 × 600"),
  );
  await page.click("#saveLayout");
  await page.selectOption("#layouts", "0");
  await page.selectOption("#layoutTarget", "new");
  await page.click("#loadLayout");
  check(
    "layouts work while offline",
    (await page.locator("#pageSelect option").count()) === 2,
  );
  await page.click("#export");
  await page.selectOption("#exportFormat", "svg");
  const event = page.waitForEvent("download");
  await page.click("#doExport");
  const download = await event;
  await fs.mkdir("test-results", { recursive: true });
  await download.saveAs("test-results/portable.svg");
  const svg = await fs.readFile("test-results/portable.svg", "utf8");
  check(
    "SVG embeds fonts offline",
    svg.includes("data:font/ttf") && !svg.includes("/assets/fonts/"),
  );
  await page.selectOption("#exportFormat", "pdf");
  await page.selectOption("#exportPages", "all");
  await page.evaluate(
    () =>
      (window.print = () => {
        window.__printed = true;
      }),
  );
  await page.click("#doExport");
  await page.waitForFunction(() => window.__printed);
  check(
    "PDF option opens local print workflow",
    (await page.locator("#printSheet svg").count()) === 2,
  );
  check("no external network required", requests.length === 1);
  check("no JavaScript errors", errors.length === 0);
  console.log(`Completed ${checks} portable checks`);
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
