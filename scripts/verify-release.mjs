import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const root = path.resolve(import.meta.dirname, ".."),
  hash = (data) => createHash("sha256").update(data).digest("hex");
const read = (file) => fs.readFile(path.join(root, file));
const manifest = JSON.parse(await read("docs/screenshots/manifest.json"));
for (const [file, expected] of Object.entries(manifest.source_hashes))
  assert.equal(
    hash(await read(file)),
    expected,
    `Screenshot source changed: ${file}; run npm run docs:screenshots`,
  );
for (const image of manifest.images) {
  const bytes = await read("docs/screenshots/" + image.file);
  assert.equal(hash(bytes), image.sha256, "Screenshot modified: " + image.file);
  assert.equal(bytes.readUInt32BE(16), image.width);
  assert.equal(bytes.readUInt32BE(20), image.height);
}
const pkg = JSON.parse(await read("package.json")),
  lock = JSON.parse(await read("package-lock.json")).packages[""];
for (const key of [
  "name",
  "version",
  "dependencies",
  "devDependencies",
  "engines",
])
  assert.deepEqual(pkg[key], lock[key], "Lockfile mismatch: " + key);
const served = (await read("server.js")).toString(),
  modules = new Set();
async function walk(file) {
  if (modules.has(file)) return;
  modules.add(file);
  const source = (await read(file)).toString();
  for (const match of source.matchAll(/from\s+["']\.\/([^"']+)["']/g))
    await walk(match[1]);
}
await walk("app.js");
for (const file of modules)
  assert.ok(
    served.includes(`"${file}"`),
    "Module missing from server allowlist: " + file,
  );
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  { cwd: root, encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter(Boolean);
let links = 0;
for (const file of files.filter(
  (f) => f.endsWith(".md") && !f.startsWith(".agents/"),
)) {
  const markdown = (await read(file)).toString();
  for (const match of markdown.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].split(/[ #]/)[0];
    if (!target || /^[a-z]+:/i.test(target) || target.startsWith("/")) continue;
    await fs.access(
      path.resolve(root, path.dirname(file), decodeURIComponent(target)),
    );
    links++;
  }
}
console.log(
  `Release verification passed: ${files.length} repository files indexed, ${modules.size} client modules served, ${manifest.images.length} screenshots match source, ${links} local documentation links valid; package lock matches.`,
);
