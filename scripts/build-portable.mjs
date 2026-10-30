import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
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
const cache = new Map();
async function moduleURL(name) {
  if (cache.has(name)) return cache.get(name);
  let source = await fs.readFile(path.join(root, name), "utf8");
  if (name === "render.js")
    source = source.replaceAll(
      "fonts = {}",
      "fonts = globalThis.BADGE_PORTABLE_FONTS || {}",
    );
  if (name === "exports.js") {
    source = source.replace(
      "export function embeddedFonts() {",
      "export function embeddedFonts() {\n if(globalThis.BADGE_PORTABLE_FONTS) return Promise.resolve(globalThis.BADGE_PORTABLE_FONTS);",
    );
    source = source.replace(
      "export async function exportFiles(project, indices, format, options) {",
      'export async function exportFiles(project, indices, format, options) {\n if(globalThis.BADGE_PORTABLE && format === "pdf") format="print";',
    );
  }
  const imports = [...source.matchAll(/from\s+["']\.\/([^"']+)["']/g)];
  for (const m of imports) {
    const url = await moduleURL(m[1]);
    source = source.replace(m[0], `from "${url}"`);
  }
  const url =
    "data:text/javascript;base64," + Buffer.from(source).toString("base64");
  cache.set(name, url);
  return url;
}
let html = await fs.readFile(path.join(root, "index.html"), "utf8"),
  css = await fs.readFile(path.join(root, "style.css"), "utf8");
for (const [k, data] of Object.entries(fonts))
  css = css.replaceAll(`/assets/fonts/${k}.ttf`, data);
html = html.replace(
  '<link rel="stylesheet" href="/style.css" />',
  `<style>${css}</style>`,
);
html = html.replace(
  /<button\s+id="account">[\s\S]*?<\/button\s*>/,
  '<button id="account" disabled title="ใช้บัญชีได้ในรุ่นเซิร์ฟเวอร์">บัญชี (รุ่นเซิร์ฟเวอร์)</button>',
);
html = html.replace(
  "ออกแบบง่าย • ขนาดจริง • พร้อมพิมพ์",
  "รุ่นไฟล์เดียว • บันทึกในเครื่อง • PDF ผ่านหน้าต่างพิมพ์",
);
html = html.replace(
  "PDF หลายหน้า / ขนาดจริง",
  "PDF ผ่านหน้าต่างพิมพ์ / บันทึกเป็น PDF",
);
const entry = await moduleURL("app.js");
html = html.replace(
  '<script type="module" src="/app.js"></script>',
  `<script>globalThis.BADGE_PORTABLE=true;globalThis.BADGE_PORTABLE_FONTS=${JSON.stringify(fonts)};</script><script type="module">import "${entry}";</script>`,
);
if (html.includes('src="/app.js"') || html.includes('href="/style.css"'))
  throw Error("Portable build has external app references");
await fs.mkdir(path.join(root, "portable"), { recursive: true });
await fs.writeFile(path.join(root, "portable/My-Badge-Studio.html"), html);
console.log(
  "Built portable/My-Badge-Studio.html:",
  Buffer.byteLength(html),
  "bytes",
);
