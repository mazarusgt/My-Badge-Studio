import { renderPage, renderDXF } from "./render.js";
export async function api(url, options = {}) {
  const r = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (!r.ok) {
    const err = await r
      .json()
      .catch(() => ({ error: "เซิร์ฟเวอร์ไม่ตอบกลับ" }));
    throw Error(err.error);
  }
  return r;
}
export function download(name, data, type = "application/octet-stream") {
  const url = URL.createObjectURL(
      data instanceof Blob ? data : new Blob([data], { type }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
let fontPromise;
export function embeddedFonts() {
  if (!fontPromise)
    fontPromise = Promise.all(
      ["sans", "serif", "hand", "latin"].map(async (k) => {
        const r = await fetch(`/assets/fonts/${k}.ttf`);
        if (!r.ok) throw Error("โหลดแบบอักษรไม่สำเร็จ");
        const data = await r.blob();
        return [
          k,
          await new Promise((resolve, reject) => {
            const f = new FileReader();
            f.onload = () => resolve(f.result);
            f.onerror = reject;
            f.readAsDataURL(data);
          }),
        ];
      }),
    )
      .then(Object.fromEntries)
      .catch((e) => {
        fontPromise = null;
        throw e;
      });
  return fontPromise;
}
export function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
export function pngDPI(bytes, dpi) {
  const ppm = Math.round(dpi / 0.0254),
    chunk = new Uint8Array(21),
    v = new DataView(chunk.buffer);
  v.setUint32(0, 9);
  chunk.set(new TextEncoder().encode("pHYs"), 4);
  v.setUint32(8, ppm);
  v.setUint32(12, ppm);
  chunk[16] = 1;
  v.setUint32(17, crc32(chunk.slice(4, 17)));
  const out = new Uint8Array(bytes.length + chunk.length);
  out.set(bytes.slice(0, 33));
  out.set(chunk, 33);
  out.set(bytes.slice(33), 54);
  return out;
}
export async function zip(files) {
  const enc = new TextEncoder(),
    entries = [],
    chunks = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name),
      data =
        f.data instanceof Uint8Array
          ? f.data
          : typeof f.data === "string"
            ? enc.encode(f.data)
            : new Uint8Array(await f.data.arrayBuffer());
    const crc = crc32(data),
      local = new Uint8Array(30 + name.length),
      v = new DataView(local.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x800, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, data.length, true);
    v.setUint32(22, data.length, true);
    v.setUint16(26, name.length, true);
    local.set(name, 30);
    chunks.push(local, data);
    const central = new Uint8Array(46 + name.length),
      c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x800, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.set(name, 46);
    entries.push(central);
    offset += local.length + data.length;
  }
  const centralSize = entries.reduce((n, x) => n + x.length, 0),
    end = new Uint8Array(22),
    e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, entries.length, true);
  e.setUint16(10, entries.length, true);
  e.setUint32(12, centralSize, true);
  e.setUint32(16, offset, true);
  return new Blob([...chunks, ...entries, end], { type: "application/zip" });
}
export async function png(project, page, options) {
  const width = Math.round((page.paper.width / 25.4) * options.dpi),
    height = Math.round((page.paper.height / 25.4) * options.dpi);
  if (width * height > 50000000)
    throw Error("ภาพเกิน 50 ล้านพิกเซล กรุณาลด DPI");
  const source = renderPage(project, page, {
      ...options,
      production: true,
      opaque: !options.transparent,
    }),
    url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(image, 0, 0);
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) throw Error("สร้าง PNG ไม่สำเร็จ");
    return pngDPI(new Uint8Array(await blob.arrayBuffer()), options.dpi);
  } finally {
    URL.revokeObjectURL(url);
  }
}
export async function exportFiles(project, indices, format, options) {
  if (format === "pdf") {
    const r = await api("/api/pdf", {
      method: "POST",
      body: JSON.stringify({
        project,
        indices,
        art: options.art,
        lines: options.lines,
        marks: options.marks,
      }),
    });
    download("badge-studio.pdf", await r.blob());
    return;
  }
  const fonts = await embeddedFonts();
  const opts = { ...options, fonts };
  if (format === "print") {
    document.getElementById("printSheet")?.remove();
    const div = document.createElement("div");
    div.id = "printSheet";
    div.hidden = true;
    div.innerHTML = indices
      .map(
        (i) =>
          `<section style="page:sheet${i}">${renderPage(project, project.pages[i], { ...opts, prefix: `page${i}-`, production: true })}</section>`,
      )
      .join("");
    div.hidden = false;
    div.style.display = "none";
    document.body.append(div);
    document.getElementById("printStyle")?.remove();
    const css = document.createElement("style");
    css.id = "printStyle";
    css.textContent = indices
      .map(
        (i) =>
          `@page sheet${i}{size:${project.pages[i].paper.width}mm ${project.pages[i].paper.height}mm;margin:0}`,
      )
      .join("");
    document.head.append(css);
    await document.fonts.ready;
    await new Promise((r) => setTimeout(r, 250));
    window.print();
    return;
  }
  const files = [];
  for (const i of indices) {
    const pg = project.pages[i];
    files.push({
      name: `badge-page-${i + 1}.${format}`,
      data:
        format === "svg"
          ? renderPage(project, pg, { ...opts, production: true })
          : format === "dxf"
            ? renderDXF(pg)
            : await png(project, pg, opts),
    });
  }
  if (files.length === 1)
    download(
      files[0].name,
      files[0].data,
      format === "svg"
        ? "image/svg+xml"
        : format === "png"
          ? "image/png"
          : "application/dxf",
    );
  else download("badge-pages.zip", await zip(files));
}
