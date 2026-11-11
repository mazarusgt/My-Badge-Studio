export const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
export const fontNames = {
  sans: "BadgeSans",
  serif: "BadgeSerif",
  hand: "BadgeLooped",
};
export function fontCSS(fonts = {}) {
  return ["sans", "serif", "hand", "latin"]
    .map(
      (k) =>
        `@font-face{font-family:${fontNames[k] || "BadgeLatin"};src:url('${fonts[k] || `/assets/fonts/${k}.ttf`}') format('truetype');font-weight:100 900}`,
    )
    .join("");
}
export function renderPage(
  project,
  page,
  {
    production = false,
    selected = -1,
    selectedIds = null,
    art = true,
    lines = true,
    marks = true,
    fonts = {},
    opaque = false,
    prefix = "page-",
  } = {},
) {
  const q = page.paper;
  const usedAssets = [
      ...new Set(page.items.filter((a) => a.image).map((a) => a.image.asset)),
    ],
    assetRefs = new Map(usedAssets.map((k, i) => [k, prefix + "asset" + i]));
  const attrs = (s) =>
    `stroke="${s.color}" stroke-width="${s.width}" stroke-opacity="${s.opacity}" stroke-dasharray="${s.dash}" fill="none"`;
  const shown = (k) => project.styles[k][production ? "export" : "preview"];
  const shape = (a, size, extra) =>
    a.type === "square"
      ? `<rect x="${(a.outer - size) / 2}" y="${(a.outer - size) / 2}" width="${size}" height="${size}" ${extra}/>`
      : `<circle cx="${a.outer / 2}" cy="${a.outer / 2}" r="${size / 2}" ${extra}/>`;
  let out = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${q.width}mm" height="${q.height}mm" viewBox="0 0 ${q.width} ${q.height}" role="group" aria-label="หน้ากระดาษออกแบบ"><style>${fontCSS(fonts)}</style><defs>${usedAssets
    .map((k) => {
      const asset = project.assets[k];
      return `<image id="${assetRefs.get(k)}" width="${asset.width}" height="${asset.height}" href="${asset.data}"/>`;
    })
    .join(
      "",
    )}${page.items.map((a, i) => `<clipPath id="${prefix}clip${i}">${shape(a, a.outer, "")}</clipPath>`).join("")}</defs>${opaque ? `<rect width="100%" height="100%" fill="white"/>` : ""}`;
  for (let i = 0; i < page.items.length; i++) {
    const a = page.items[i],
      d = a.outer;
    out += `<g data-slot="${i}" transform="translate(${a.x} ${a.y})" tabindex="${production ? -1 : 0}" role="button" ${production ? "" : `aria-pressed="${selectedIds ? selectedIds.includes(a.id) : selected === i}"`} aria-label="ชิ้นที่ ${i + 1}">`;
    if (art) {
      out +=
        shape(a, d, `fill="${a.background}"`) +
        `<g clip-path="url(#${prefix}clip${i})">`;
      if (a.image) {
        const im = a.image,
          asset = project.assets[im.asset],
          ratio = asset.width / asset.height;
        let w, h;
        if ((im.fit === "cover") === ratio > 1) {
          h = d;
          w = h * ratio;
        } else {
          w = d;
          h = w / ratio;
        }
        w *= im.scale;
        h *= im.scale;
        out += `<g transform="translate(${d / 2 + im.dx} ${d / 2 + im.dy}) rotate(${im.rotation})"><use href="#${assetRefs.get(im.asset)}" xlink:href="#${assetRefs.get(im.asset)}" transform="translate(${-w / 2} ${-h / 2}) scale(${w / asset.width} ${h / asset.height})"/></g>`;
      }
      for (const t of a.texts) {
        out += `<text x="${t.x}" y="${t.y}" text-anchor="middle" font-family="${fontNames[t.font]},BadgeLatin,sans-serif" font-weight="${t.weight}" font-size="${t.size}" fill="${t.color}" transform="rotate(${t.rotation} ${t.x} ${t.y})">${t.text
          .split("\n")
          .map(
            (line, n) =>
              `<tspan x="${t.x}" dy="${n ? t.size * 1.4 : 0}">${esc(line)}</tspan>`,
          )
          .join("")}</text>`;
      }
      out += "</g>";
    }
    if (lines)
      for (const [k, size] of [
        ["cut", d],
        ["face", a.face],
        ["safe", Math.max(0, a.face - 2 * a.safe)],
      ])
        if (shown(k) && size > 0)
          out += shape(a, size, attrs(project.styles[k]));
    if (
      !production &&
      (selectedIds ? selectedIds.includes(a.id) : selected === i)
    )
      out +=
        shape(a, d, 'fill="none" stroke="#5b21b6" stroke-width="2.4"') +
        shape(a, d, 'fill="none" stroke="#e9caff" stroke-width="1.2"');
    if (marks && shown("marks") && project.cropMarks) {
      const s = project.styles.marks,
        o = s.offset,
        z = s.size;
      out += `<path ${attrs(s)} d="M ${-o - z} 0 H ${-o} M 0 ${-o - z} V ${-o} M ${d + o} 0 h ${z} M ${d} ${-o - z} V ${-o} M ${-o - z} ${d} H ${-o} M 0 ${d + o} v ${z} M ${d + o} ${d} h ${z} M ${d} ${d + o} v ${z}"/>`;
    }
    out += "</g>";
  }
  if (marks && shown("marks") && project.registration) {
    const s = project.styles.marks,
      r = s.size / 2;
    for (const [x, y] of [
      [q.left / 2, q.top / 2],
      [q.width - q.right / 2, q.top / 2],
      [q.left / 2, q.height - q.bottom / 2],
      [q.width - q.right / 2, q.height - q.bottom / 2],
    ])
      out += `<path ${attrs(s)} d="M ${x - r} ${y} H ${x + r} M ${x} ${y - r} V ${y + r}"/>`;
  }
  return out + "</svg>";
}
export function renderDXF(page) {
  let s =
    "0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n9\n$MEASUREMENT\n70\n1\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n";
  for (const a of page.items) {
    const d = a.outer,
      x = a.x,
      y = page.paper.height - a.y;
    if (a.type === "square") {
      const pts = [
        [x, y],
        [x + d, y],
        [x + d, y - d],
        [x, y - d],
      ];
      for (let i = 0; i < 4; i++) {
        const [ax, ay] = pts[i],
          [bx, by] = pts[(i + 1) % 4];
        s += `0\nLINE\n8\nCUT\n10\n${ax}\n20\n${ay}\n11\n${bx}\n21\n${by}\n`;
      }
    } else
      s += `0\nCIRCLE\n8\nCUT\n10\n${x + d / 2}\n20\n${y - d / 2}\n40\n${d / 2}\n`;
  }
  return s + "0\nENDSEC\n0\nEOF\n";
}
