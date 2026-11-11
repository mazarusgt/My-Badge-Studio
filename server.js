import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright-core";
import { PDFDocument } from "pdf-lib";
import { validateProject, productionWarnings } from "./model.js";
import { renderPage } from "./render.js";
const root = path.dirname(fileURLToPath(import.meta.url)),
  port = Number(process.env.PORT || 5173),
  dataDir = process.env.BADGE_DATA_DIR || path.join(root, ".data");
await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(path.join(dataDir, "studio.sqlite"));
db.exec(
  `PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL,salt TEXT NOT NULL,hash TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),name TEXT NOT NULL,data TEXT NOT NULL,updated INTEGER NOT NULL);`,
);
const scrypt = promisify(scryptCallback),
  digest = (s) => createHash("sha256").update(s).digest("hex");
const fonts = Object.fromEntries(
  await Promise.all(
    ["sans", "serif", "hand", "latin"].map(async (k) => [
      k,
      "data:font/ttf;base64," +
        (
          await fs.readFile(path.join(root, "assets/fonts", k + ".ttf"))
        ).toString("base64"),
    ]),
  ),
);
const json = (res, status, value, headers = {}) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(JSON.stringify(value));
};
async function body(req) {
  const chunks = [];
  let length = 0;
  for await (const c of req) {
    length += c.length;
    if (length > 50 * 1024 * 1024)
      throw Object.assign(Error("ข้อมูลเกิน 50 MB กรุณาลดขนาดโปรเจกต์"), {
        status: 413,
      });
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(Error("JSON ไม่ถูกต้อง"), { status: 400 });
  }
}
function session(req) {
  const token = (req.headers.cookie || "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("badge_session="))
    ?.slice(14);
  if (!token) return null;
  return db
    .prepare(
      "SELECT users.id,users.username FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>?",
    )
    .get(digest(token), Date.now());
}
const attempts = new Map();
function rate(req) {
  const key = req.socket.remoteAddress || "",
    now = Date.now();
  let a = attempts.get(key);
  if (!a || now - a.at > 600000) {
    a = { at: now, count: 0 };
    attempts.set(key, a);
  }
  if (++a.count > 30)
    throw Object.assign(
      Error("ลองเข้าสู่ระบบหลายครั้งเกินไป กรุณารอ 10 นาที"),
      { status: 429 },
    );
}
let browserPromise,
  pdfBusy = false;
async function browser() {
  if (!browserPromise)
    browserPromise = chromium
      .launch({
        executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      })
      .catch((e) => {
        browserPromise = null;
        throw e;
      });
  return browserPromise;
}
const server = http.createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");
  try {
    const url = new URL(req.url, "http://localhost");
    const route = url.pathname;
    if (req.method !== "GET" && req.headers.origin) {
      const expected =
        process.env.PUBLIC_ORIGIN || `http://${req.headers.host}`;
      if (req.headers.origin !== expected)
        throw Object.assign(Error("ไม่อนุญาตคำขอข้ามเว็บไซต์"), {
          status: 403,
        });
    }
    if (route === "/api/health") return json(res, 200, { ok: true });
    if (route === "/api/account" && req.method === "GET")
      return json(res, 200, { user: session(req)?.username || null });
    if (
      ["/api/login", "/api/register"].includes(route) &&
      req.method === "POST"
    ) {
      rate(req);
      const b = await body(req),
        username = String(b.username || "").trim(),
        password = String(b.password || "");
      if (
        !/^[a-zA-Z0-9_\-.]{3,40}$/.test(username) ||
        password.length < 10 ||
        password.length > 200
      )
        throw Object.assign(
          Error(
            "ชื่อบัญชี 3–40 ตัว (อังกฤษ/ตัวเลข/_.-) และรหัสผ่านอย่างน้อย 10 ตัว",
          ),
          { status: 400 },
        );
      let u = db.prepare("SELECT * FROM users WHERE username=?").get(username);
      if (route === "/api/register") {
        if (u)
          throw Object.assign(Error("ชื่อบัญชีนี้ถูกใช้แล้ว"), { status: 409 });
        const salt = randomBytes(16).toString("hex"),
          hash = (await scrypt(password, salt, 64)).toString("hex");
        const result = db
          .prepare("INSERT INTO users(username,salt,hash) VALUES(?,?,?)")
          .run(username, salt, hash);
        u = { id: Number(result.lastInsertRowid), username };
      } else {
        const hash = await scrypt(password, u?.salt || "dummy-salt", 64);
        if (!u || !timingSafeEqual(hash, Buffer.from(u.hash, "hex")))
          throw Object.assign(Error("ชื่อบัญชีหรือรหัสผ่านไม่ถูกต้อง"), {
            status: 401,
          });
      }
      db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
      const token = randomBytes(32).toString("hex");
      db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
        digest(token),
        u.id,
        Date.now() + 7 * 86400000,
      );
      return json(
        res,
        200,
        { user: u.username },
        {
          "Set-Cookie": `badge_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${process.env.PUBLIC_ORIGIN?.startsWith("https:") ? "; Secure" : ""}`,
        },
      );
    }
    if (route === "/api/logout" && req.method === "POST") {
      const raw = (req.headers.cookie || "")
        .split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith("badge_session="))
        ?.slice(14);
      if (raw)
        db.prepare("DELETE FROM sessions WHERE token=?").run(digest(raw));
      return json(
        res,
        200,
        { ok: true },
        {
          "Set-Cookie":
            "badge_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
        },
      );
    }
    if (route === "/api/projects" || route.startsWith("/api/projects/")) {
      const u = session(req);
      if (!u)
        throw Object.assign(Error("กรุณาเข้าสู่ระบบก่อน"), { status: 401 });
      if (route === "/api/projects" && req.method === "GET")
        return json(
          res,
          200,
          db
            .prepare(
              "SELECT id,name,updated FROM projects WHERE user_id=? ORDER BY updated DESC",
            )
            .all(u.id),
        );
      const pid = route.slice("/api/projects/".length);
      if (!/^[a-zA-Z0-9-]{1,80}$/.test(pid))
        throw Object.assign(Error("รหัสโปรเจกต์ไม่ถูกต้อง"), { status: 400 });
      const existing = db
        .prepare("SELECT * FROM projects WHERE id=? AND user_id=?")
        .get(pid, u.id);
      if (req.method === "GET") {
        if (!existing)
          throw Object.assign(Error("ไม่พบโปรเจกต์"), { status: 404 });
        return json(res, 200, JSON.parse(existing.data));
      }
      if (req.method === "PUT") {
        const p = validateProject(await body(req));
        if (
          !existing &&
          db
            .prepare("SELECT COUNT(*) AS n FROM projects WHERE user_id=?")
            .get(u.id).n >= 50
        )
          throw Object.assign(Error("บันทึกได้สูงสุด 50 โปรเจกต์ต่อบัญชี"), {
            status: 409,
          });
        if (
          !existing &&
          db.prepare("SELECT id FROM projects WHERE id=?").get(pid)
        )
          throw Object.assign(Error("รหัสโปรเจกต์ซ้ำ"), { status: 409 });
        db.prepare(
          "INSERT INTO projects VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,data=excluded.data,updated=excluded.updated WHERE projects.user_id=excluded.user_id",
        ).run(pid, u.id, p.name, JSON.stringify(p), Date.now());
        return json(res, 200, { ok: true });
      }
      if (req.method === "DELETE") {
        if (!existing)
          throw Object.assign(Error("ไม่พบโปรเจกต์"), { status: 404 });
        db.prepare("DELETE FROM projects WHERE id=? AND user_id=?").run(
          pid,
          u.id,
        );
        return json(res, 200, { ok: true });
      }
    }
    if (route === "/api/pdf" && req.method === "POST") {
      if (pdfBusy)
        throw Object.assign(Error("กำลังสร้าง PDF อื่น กรุณาลองอีกครั้ง"), {
          status: 429,
        });
      const b = await body(req),
        p = validateProject(b.project);
      if (
        !Array.isArray(b.indices) ||
        !b.indices.length ||
        b.indices.length > 100 ||
        b.indices.some(
          (i) => !Number.isInteger(i) || i < 0 || i >= p.pages.length,
        )
      )
        throw Object.assign(Error("ช่วงหน้าไม่ถูกต้อง"), { status: 400 });
      for (const i of b.indices)
        if (productionWarnings(p, p.pages[i]).length)
          throw Object.assign(
            Error("มีชิ้นงานทับกันหรือเกินพื้นที่ กรุณาแก้ก่อนส่งออก"),
            { status: 400 },
          );
      pdfBusy = true;
      let context;
      try {
        context = await (await browser()).newContext();
        await context.route("**/*", (r) => r.abort());
        const tab = await context.newPage(),
          pdf = await PDFDocument.create();
        for (const i of b.indices) {
          const pg = p.pages[i];
          await tab.setContent(
            `<html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0}svg{display:block}@page{size:${pg.paper.width}mm ${pg.paper.height}mm;margin:0}</style></head><body>${renderPage(p, pg, { production: true, fonts, art: b.art !== false, lines: b.lines !== false, marks: b.marks !== false })}</body></html>`,
            { waitUntil: "load" },
          );
          await tab.evaluate(async () => {
            await document.fonts.ready;
            await Promise.all(
              [...document.images].map((im) => im.decode().catch(() => {})),
            );
          });
          const bytes = await tab.pdf({
            preferCSSPageSize: true,
            printBackground: true,
            scale: 1,
            timeout: 60000,
          });
          const src = await PDFDocument.load(bytes);
          for (const copied of await pdf.copyPages(src, src.getPageIndices())) {
            const targetWidth = (pg.paper.width / 25.4) * 72,
              targetHeight = (pg.paper.height / 25.4) * 72;
            copied.translateContent(0, targetHeight - copied.getHeight());
            copied.setSize(targetWidth, targetHeight);
            pdf.addPage(copied);
          }
        }
        const bytes = await pdf.save();
        res.writeHead(200, {
          "Content-Type": "application/pdf",
          "Content-Disposition": 'attachment; filename="badge-studio.pdf"',
          "Cache-Control": "no-store",
        });
        res.end(Buffer.from(bytes));
        return;
      } finally {
        await context?.close();
        pdfBusy = false;
      }
    }
    if (route.startsWith("/api/"))
      return json(res, 404, { error: "ไม่พบคำสั่ง" });
    if (req.method !== "GET" && req.method !== "HEAD")
      return json(res, 405, { error: "Method not allowed" });
    const files = new Set([
      "index.html",
      "app.js",
      "batch.js",
      "workspace-state.js",
      "template-manager.js",
      "position-controls.js",
      "badge-editor.js",
      "editor-controls.js",
      "model.js",
      "render.js",
      "geometry.js",
      "storage.js",
      "exports.js",
      "style.css",
    ]);
    const rel = decodeURIComponent(route).replace(/^\//, "") || "index.html";
    if (
      !files.has(rel) &&
      !/^assets\/fonts\/(sans|serif|hand|latin)\.ttf$/.test(rel)
    )
      return json(res, 404, { error: "ไม่พบไฟล์" });
    const data = await fs.readFile(path.join(root, rel));
    const ext = path.extname(rel);
    res.writeHead(200, {
      "Content-Type":
        {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".ttf": "font/ttf",
        }[ext] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch (e) {
    if (!res.headersSent)
      json(res, e.status || 400, { error: e.message || "คำขอไม่สำเร็จ" });
    else res.end();
  }
});
server.listen(port, "0.0.0.0", () =>
  console.log(`My Badge Studio running on port ${port}`),
);
for (const sig of ["SIGINT", "SIGTERM"])
  process.on(sig, async () => {
    server.close();
    if (browserPromise) await (await browserPromise).close();
    db.close();
    process.exit(0);
  });
