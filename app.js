import { units } from "./geometry.js";
import {
  clone,
  id,
  newProject,
  newPage,
  newItem,
  presets,
  gridItems,
  packItems,
  pageWarnings,
  productionWarnings,
  pageIndices,
  parseCSV,
  mergeText,
  validateProject,
  layoutSnapshot,
  migrate,
} from "./model.js";
import { renderPage, esc } from "./render.js";
import * as store from "./storage.js";
import { api, download, exportFiles } from "./exports.js";
const $ = (id) => document.getElementById(id);
function parseColor(value) {
  if (/^#[a-f0-9]{6}$/i.test(value)) return value.toLowerCase();
  const m = value.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
  if (m && m.slice(1).every((v) => Number(v) <= 255))
    return (
      "#" +
      m
        .slice(1)
        .map((v) => Number(v).toString(16).padStart(2, "0"))
        .join("")
    );
  throw Error("สีต้องเป็น #RRGGBB หรือ rgb(0, 0, 0)");
}
let project = newProject(),
  pageIndex = 0,
  selected = 0,
  layerIndex = 0,
  serverId = null,
  username = null,
  undo = [],
  redo = [],
  saveTimer,
  layoutRecords = [];
const inputUnits = {};
const pg = () => project.pages[pageIndex],
  item = () => pg().items[selected],
  text = () => item()?.texts[layerIndex];
const status = (message, error = false) => {
  $("status").textContent = message;
  $("status").classList.toggle("warning", error);
};
const report = (e) => {
  const message = e.message || String(e);
  status(message, true);
  const dialog = document.querySelector("dialog[open]");
  if (dialog) {
    let target = dialog.querySelector("[role=status]");
    if (!target) {
      target = document.createElement("p");
      target.setAttribute("role", "status");
      dialog.append(target);
    }
    target.textContent = message;
  }
};
function setValue(id, value) {
  $(id).value = value ?? "";
}
function dimValue(id, mm) {
  setValue(
    id,
    Number((mm / units[inputUnits[id] || project.unit]).toPrecision(12)),
  );
}
function dimRead(id) {
  const raw = $(id).value;
  if (raw.trim() === "") throw Error("กรุณาระบุขนาดให้ครบ");
  const n = Number(raw) * units[inputUnits[id] || project.unit];
  if (!Number.isFinite(n)) throw Error("ขนาดต้องเป็นตัวเลข");
  return n;
}
let saveQueue = Promise.resolve(),
  saveRevision = 0,
  saving = false;
function autosave() {
  const revision = ++saveRevision,
    snapshot = clone(project);
  saving = true;
  $("saveStatus").textContent = "กำลังบันทึก…";
  saveQueue = saveQueue
    .catch(() => {})
    .then(() => store.put("autosave", snapshot))
    .then(() => {
      if (revision === saveRevision) {
        saving = false;
        $("saveStatus").textContent = "บันทึกในเบราว์เซอร์แล้ว";
      }
    })
    .catch(() => {
      if (revision === saveRevision) {
        saving = false;
        $("saveStatus").textContent =
          "บันทึกอัตโนมัติไม่สำเร็จ กรุณาดาวน์โหลดไฟล์สำรอง";
      }
    });
}
function transaction(fn, message) {
  const before = clone(project);
  try {
    fn();
    validateProject(project);
    undo.push(before);
    if (undo.length > 30) undo.shift();
    redo = [];
    render();
    autosave();
    if (message) status(message);
  } catch (e) {
    project = before;
    render();
    report(e);
  }
}
function switchProject(p) {
  validateProject(p);
  transaction(() => {
    project = clone(p);
    pageIndex = 0;
    selected = 0;
    layerIndex = 0;
    serverId = null;
    for (const k of Object.keys(inputUnits)) inputUnits[k] = project.unit;
  }, "เปิดโปรเจกต์แล้ว");
}
function normalizeSelection() {
  pageIndex = Math.min(Math.max(0, pageIndex), project.pages.length - 1);
  selected = Math.min(
    Math.max(0, selected),
    Math.max(0, pg().items.length - 1),
  );
  layerIndex = Math.min(
    Math.max(0, layerIndex),
    Math.max(0, (item()?.texts.length || 0) - 1),
  );
}
function syncStyle() {
  const s = project.styles[$("styleTarget").value];
  setValue("lineColor", s.color);
  dimValue("lineWidth", s.width);
  setValue("lineOpacity", s.opacity);
  setValue("lineDash", s.dash);
  dimValue("markSize", s.size);
  dimValue("markOffset", s.offset);
  $("linePreview").checked = s.preview;
  $("lineExport").checked = s.export;
  $("cropMarks").checked = project.cropMarks;
  $("registration").checked = project.registration;
}
function syncForm() {
  normalizeSelection();
  const a = item(),
    p = pg().paper,
    l = pg().layout;
  setValue("projectName", project.name);
  setValue("unit", project.unit);
  for (const [key, value] of Object.entries(p)) dimValue(key, value);
  for (const k of ["gapX", "gapY"]) dimValue(k, l[k]);
  for (const k of ["cols", "rows"]) setValue(k, l[k]);
  const paperMatch = [...$("paper").options].find(
    (o) => o.value === `${p.width},${p.height}`,
  );
  setValue("paper", paperMatch ? paperMatch.value : "custom");
  $("selection").textContent = a
    ? `ชิ้นที่ ${selected + 1} / ${pg().items.length}`
    : "หน้านี้ยังไม่มีชิ้นงาน";
  const design = a || newItem();
  setValue("type", design.type);
  $("preset").innerHTML =
    presets[design.type]
      .map((n) => `<option value="${n}">${n} mm</option>`)
      .join("") + '<option value="custom">กำหนดเอง</option>';
  setValue(
    "preset",
    presets[design.type].includes(design.face) ? String(design.face) : "custom",
  );
  for (const k of ["face", "outer", "safe"]) dimValue(k, design[k]);
  setValue("notes", design.notes);
  dimValue("itemX", design.x);
  dimValue("itemY", design.y);
  setValue("background", design.background);
  setValue("backgroundHex", design.background);
  const im = design.image;
  setValue("imageFit", im?.fit || "cover");
  setValue("imageScale", Number(((im?.scale || 1) * 100).toPrecision(12)));
  dimValue("imageX", im?.dx || 0);
  dimValue("imageY", im?.dy || 0);
  setValue("imageRotation", im?.rotation || 0);
  $("textLayer").innerHTML = design.texts.length
    ? design.texts
        .map(
          (t, i) =>
            `<option value="${i}">${i + 1}. ${esc(t.text.slice(0, 25) || "(ข้อความว่าง)")}</option>`,
        )
        .join("")
    : '<option value="">ยังไม่มีข้อความ</option>';
  setValue("textLayer", design.texts.length ? String(layerIndex) : "");
  const t = text();
  setValue("caption", t?.text || "");
  setValue("font", t?.font || "sans");
  setValue("weight", t?.weight || "normal");
  dimValue("textSize", t?.size || 5);
  dimValue("textX", t?.x ?? design.outer / 2);
  dimValue("textY", t?.y ?? design.outer * 0.7);
  setValue("textRotation", t?.rotation || 0);
  setValue("textColor", t?.color || "#172033");
  setValue("textHex", t?.color || "#172033");
  for (const k of [
    "caption",
    "font",
    "weight",
    "textSize",
    "textX",
    "textY",
    "textRotation",
    "textColor",
    "textHex",
    "deleteText",
    "textFront",
  ])
    $(k).disabled = !t;
  for (const k of [
    "imageFit",
    "imageScale",
    "imageX",
    "imageY",
    "imageRotation",
    "clearImage",
  ])
    $(k).disabled = !im;
  if (im) {
    const asset = project.assets[im.asset],
      effective =
        Math.min(asset.width, asset.height) / ((a.outer * im.scale) / 25.4);
    $("imageQuality").textContent =
      `ต้นฉบับ ${asset.width} × ${asset.height} px • ประมาณ ${Math.round(effective)} DPI ที่ขนาดนี้${effective < 200 ? " — ภาพอาจไม่คมเมื่อพิมพ์" : ""}`;
  } else
    $("imageQuality").textContent =
      "เก็บภาพต้นฉบับ ไม่ลดความละเอียดระหว่างนำเข้า";
  $("pageSelect").innerHTML = project.pages
    .map(
      (p, i) =>
        `<option value="${i}">${i + 1} / ${project.pages.length}</option>`,
    )
    .join("");
  setValue("pageSelect", pageIndex);
  $("prevPage").disabled = pageIndex === 0;
  $("nextPage").disabled = pageIndex === project.pages.length - 1;
  $("deletePage").disabled = project.pages.length === 1;
  $("undo").disabled = !undo.length;
  $("redo").disabled = !redo.length;
  for (const [k, u] of Object.entries(inputUnits)) $(`${k}Unit`).value = u;
  syncStyle();
}
function zoom() {
  const svg = $("sheet").querySelector("svg");
  if (!svg) return;
  const scale =
    $("zoom").value === "fit"
      ? Math.max(
          0.1,
          Math.min(
            1,
            ($("canvas").clientWidth - 50) / ((pg().paper.width * 96) / 25.4),
            ($("canvas").clientHeight - 50) / ((pg().paper.height * 96) / 25.4),
          ),
        )
      : Number($("zoom").value);
  $("sheet").style.transform = `scale(${scale})`;
  $("sheetWrap").style.width = `${((pg().paper.width * 96) / 25.4) * scale}px`;
  $("sheetWrap").style.height =
    `${((pg().paper.height * 96) / 25.4) * scale}px`;
}
function render() {
  normalizeSelection();
  syncForm();
  $("sheet").innerHTML = renderPage(project, pg(), { selected });
  zoom();
  $("count").textContent =
    `${pg().items.length} ชิ้นในหน้านี้ • ${project.pages.length} หน้า`;
  const warnings = productionWarnings(project, pg());
  status(
    warnings.length
      ? `${warnings.slice(0, 4).join(" • ")}${warnings.length > 4 ? " …" : ""}`
      : pg().items.length
        ? "คลิกชิ้นงานเพื่อแก้ไข • เส้นช่วยออกแบบจะไม่ส่งออก เว้นแต่เปิดไว้"
        : "เพิ่มชิ้นงาน หรือโหลดเทมเพลตเพื่อเริ่ม",
    !!warnings.length,
  );
}
function needItem() {
  if (!item()) {
    pg().items.push(newItem());
    selected = pg().items.length - 1;
  }
  return item();
}
for (const input of document.querySelectorAll("[data-dim]")) {
  inputUnits[input.id] = "mm";
  const wrapper = document.createElement("div");
  wrapper.className = "dimension";
  input.parentNode.insertBefore(wrapper, input);
  wrapper.append(input);
  const s = document.createElement("select");
  s.id = input.id + "Unit";
  s.setAttribute(
    "aria-label",
    `หน่วย ${input.parentElement.parentElement.firstChild.textContent.trim()}`,
  );
  s.innerHTML = "<option>mm</option><option>cm</option><option>inch</option>";
  wrapper.append(s);
  s.onchange = () => {
    inputUnits[input.id] = s.value;
    syncForm();
  };
}
function on(id, event, fn) {
  $(id).addEventListener(event, async (e) => {
    try {
      await fn(e);
    } catch (error) {
      report(error);
    }
  });
}
function bindDim(ids, target) {
  for (const k of ids)
    on(k, "change", () =>
      transaction(() => {
        target()[k] = dimRead(k);
      }),
    );
}
bindDim(["face", "outer", "safe"], needItem);
bindDim(
  ["width", "height", "top", "right", "bottom", "left"],
  () => pg().paper,
);
bindDim(["gapX", "gapY"], () => pg().layout);
on("unit", "change", () => {
  project.unit = $("unit").value;
  for (const k of Object.keys(inputUnits)) inputUnits[k] = project.unit;
  syncForm();
  autosave();
});
on("projectName", "change", () =>
  transaction(() => {
    project.name = $("projectName").value.trim() || "โปรเจกต์ใหม่";
  }),
);
on("notes", "change", () =>
  transaction(() => {
    needItem().notes = $("notes").value;
  }),
);
for (const k of ["cols", "rows"])
  on(k, "change", () =>
    transaction(() => {
      pg().layout[k] = Number($(k).value);
    }),
  );
on("type", "change", () =>
  transaction(() => {
    const a = needItem();
    a.type = $("type").value;
    a.face = presets[a.type][0];
    a.outer = a.face + (a.type === "round" ? 10 : 0);
    a.safe = Math.min(a.safe, a.face / 2);
  }),
);
on("preset", "change", () => {
  if ($("preset").value === "custom") return;
  transaction(() => {
    const a = needItem(),
      f = Number($("preset").value);
    a.face = f;
    a.outer = a.type === "round" ? { 57: 67, 58: 70, 59: 69 }[f] || f + 10 : f;
    a.safe = Math.min(a.safe, f / 2);
  });
});
on("paper", "change", () => {
  if ($("paper").value === "custom") return;
  transaction(() => {
    const [w, h] = $("paper").value.split(",").map(Number);
    pg().paper.width = w;
    pg().paper.height = h;
  });
});
on("rotate", "click", () =>
  transaction(() => {
    const p = pg().paper;
    [p.width, p.height] = [p.height, p.width];
  }),
);
on("fillGrid", "click", () => {
  if (
    pg().items.length &&
    !confirm(
      "จัดเต็มหน้าใหม่โดยใช้ดีไซน์ชิ้นที่เลือกแทนงานเดิมในหน้านี้? ย้อนกลับได้",
    )
  )
    return;
  transaction(() => {
    pg().items = gridItems(pg(), item() || newItem());
    selected = 0;
  }, "จัดเต็มหน้าแล้ว");
});
on("pack", "click", () => transaction(() => packItems(pg())));
on("addItem", "click", () =>
  transaction(() => {
    const a = clone(item() || newItem());
    a.id = id();
    a.x = pg().paper.left;
    a.y = pg().paper.top;
    pg().items.push(a);
    selected = pg().items.length - 1;
    try {
      packItems(pg());
    } catch {}
  }, "เพิ่มชิ้นงานแล้ว หากเกินพื้นที่ให้เพิ่มหน้าใหม่"),
);
on("duplicateItem", "click", () => {
  $("addItem").click();
});
on("deleteItem", "click", () =>
  transaction(() => {
    if (item()) pg().items.splice(selected, 1);
  }),
);
on("itemX", "change", () =>
  transaction(() => {
    needItem().x = dimRead("itemX");
  }),
);
on("itemY", "change", () =>
  transaction(() => {
    needItem().y = dimRead("itemY");
  }),
);
on("undo", "click", () => {
  if (!undo.length) return;
  redo.push(clone(project));
  project = undo.pop();
  render();
  autosave();
});
on("redo", "click", () => {
  if (!redo.length) return;
  undo.push(clone(project));
  project = redo.pop();
  render();
  autosave();
});
document.addEventListener("keydown", (e) => {
  if (
    (e.ctrlKey || e.metaKey) &&
    e.key.toLowerCase() === "z" &&
    !e.target.matches("input,textarea")
  ) {
    e.preventDefault();
    $(e.shiftKey ? "redo" : "undo").click();
  }
});
on("pageSelect", "change", () => {
  pageIndex = Number($("pageSelect").value);
  selected = 0;
  layerIndex = 0;
  render();
});
on("prevPage", "click", () => {
  if (pageIndex > 0) {
    pageIndex--;
    selected = 0;
    render();
  }
});
on("nextPage", "click", () => {
  if (pageIndex < project.pages.length - 1) {
    pageIndex++;
    selected = 0;
    render();
  }
});
on("addPage", "click", () =>
  transaction(() => {
    const p = clone(pg());
    p.id = id();
    p.items = [];
    project.pages.push(p);
    pageIndex = project.pages.length - 1;
    selected = 0;
  }),
);
on("duplicatePage", "click", () =>
  transaction(() => {
    const p = clone(pg());
    p.id = id();
    for (const a of p.items) a.id = id();
    project.pages.splice(pageIndex + 1, 0, p);
    pageIndex++;
    selected = 0;
  }),
);
on("deletePage", "click", () => {
  if (project.pages.length > 1 && confirm("ลบหน้าปัจจุบันพร้อมงานในหน้านี้?"))
    transaction(() => {
      project.pages.splice(pageIndex, 1);
      selected = 0;
    });
});
on("zoom", "change", zoom);
window.addEventListener("resize", zoom);
new ResizeObserver(zoom).observe($("canvas"));
document.fonts.ready.then(zoom);
on("sheet", "click", (e) => {
  const g = e.target.closest("[data-slot]");
  if (!g) return;
  selected = Number(g.dataset.slot);
  layerIndex = 0;
  render();
});
on("sheet", "keydown", (e) => {
  const g = e.target.closest("[data-slot]");
  if (g && ["Enter", " "].includes(e.key)) {
    e.preventDefault();
    selected = Number(g.dataset.slot);
    layerIndex = 0;
    render();
  }
});
let drag;
on("sheet", "pointerdown", (e) => {
  if (!$("moveMode").checked) return;
  const g = e.target.closest("[data-slot]");
  if (!g) return;
  e.preventDefault();
  const svg = $("sheet").querySelector("svg"),
    pos = new DOMPoint(e.clientX, e.clientY).matrixTransform(
      svg.getScreenCTM().inverse(),
    );
  selected = Number(g.dataset.slot);
  const a = item();
  drag = { g, svg, start: pos, x: a.x, y: a.y, dx: 0, dy: 0 };
});
document.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const pos = new DOMPoint(e.clientX, e.clientY).matrixTransform(
    drag.svg.getScreenCTM().inverse(),
  );
  drag.dx = Math.max(-drag.x, pos.x - drag.start.x);
  drag.dy = Math.max(-drag.y, pos.y - drag.start.y);
  drag.g.setAttribute(
    "transform",
    `translate(${drag.x + drag.dx} ${drag.y + drag.dy})`,
  );
});
document.addEventListener("pointerup", () => {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (Math.abs(d.dx) + Math.abs(d.dy) > 0.2)
    transaction(() => {
      item().x = d.x + d.dx;
      item().y = d.y + d.dy;
    });
  else render();
});
async function importImages(files) {
  const accepted = [...files];
  if (!accepted.length) return;
  const loaded = [];
  for (const file of accepted) {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
      throw Error("รองรับ PNG, JPEG และ WebP เท่านั้น");
    if (file.size > 25 * 1024 * 1024)
      throw Error("ภาพหนึ่งไฟล์ต้องไม่เกิน 25 MB");
    const data = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
      }),
      image = new Image();
    image.src = data;
    await image.decode();
    if (image.naturalWidth > 50000 || image.naturalHeight > 50000)
      throw Error("ภาพมีขนาดเกิน 50,000 พิกเซล");
    loaded.push({
      name: file.name,
      data,
      width: image.naturalWidth,
      height: image.naturalHeight,
    });
  }
  transaction(() => {
    const base = clone(item() || newItem());
    let targetPage = pageIndex,
      targetIndex = selected;
    for (let n = 0; n < loaded.length; n++) {
      if (n) {
        targetIndex++;
        while (
          targetPage < project.pages.length &&
          targetIndex >= project.pages[targetPage].items.length
        ) {
          targetPage++;
          targetIndex = 0;
        }
        if (targetPage >= project.pages.length) {
          const p = clone(pg());
          p.id = id();
          p.items = gridItems(p, base);
          if (!p.items.length) throw Error("ขนาดชิ้นงานไม่พอดีกับหน้าใหม่");
          project.pages.push(p);
        }
      }
      const p = project.pages[targetPage];
      if (!p.items.length) p.items.push({ ...clone(base), id: id() });
      const asset = id();
      project.assets[asset] = loaded[n];
      p.items[targetIndex].image = {
        asset,
        scale: 1,
        dx: 0,
        dy: 0,
        rotation: 0,
        fit: "cover",
      };
    }
  }, `นำเข้ารูป ${loaded.length} ไฟล์แล้ว เก็บความละเอียดต้นฉบับ`);
}
on("image", "change", async () => {
  await importImages($("image").files);
  $("image").value = "";
});
$("canvas").addEventListener("dragover", (e) => {
  e.preventDefault();
});
on("canvas", "drop", async (e) => {
  e.preventDefault();
  await importImages(e.dataTransfer.files);
});
on("clearImage", "click", () =>
  transaction(() => {
    if (item()) item().image = null;
  }),
);
for (const [field, key, read] of [
  ["imageFit", "fit", () => $("imageFit").value],
  ["imageScale", "scale", () => Number($("imageScale").value) / 100],
  ["imageX", "dx", () => dimRead("imageX")],
  ["imageY", "dy", () => dimRead("imageY")],
  ["imageRotation", "rotation", () => Number($("imageRotation").value)],
])
  on(field, "change", () =>
    transaction(() => {
      if (item()?.image) item().image[key] = read();
    }),
  );
for (const field of ["background", "backgroundHex"])
  on(field, "change", () =>
    transaction(() => {
      needItem().background = parseColor($(field).value);
    }),
  );
on("addText", "click", () =>
  transaction(() => {
    const a = needItem();
    a.texts.push({
      text: "ข้อความใหม่",
      size: 5,
      x: a.outer / 2,
      y: a.outer * 0.7,
      color: "#172033",
      font: "sans",
      weight: "normal",
      rotation: 0,
    });
    layerIndex = a.texts.length - 1;
  }),
);
on("deleteText", "click", () =>
  transaction(() => {
    if (text()) item().texts.splice(layerIndex, 1);
  }),
);
on("textLayer", "change", () => {
  layerIndex = Number($("textLayer").value);
  syncForm();
});
on("textFront", "click", () =>
  transaction(() => {
    if (text()) {
      const t = item().texts.splice(layerIndex, 1)[0];
      item().texts.push(t);
      layerIndex = item().texts.length - 1;
    }
  }),
);
for (const [field, key, read] of [
  ["caption", "text", () => $("caption").value],
  ["font", "font", () => $("font").value],
  ["weight", "weight", () => $("weight").value],
  ["textSize", "size", () => dimRead("textSize")],
  ["textX", "x", () => dimRead("textX")],
  ["textY", "y", () => dimRead("textY")],
  ["textRotation", "rotation", () => Number($("textRotation").value)],
  ["textColor", "color", () => $("textColor").value],
  ["textHex", "color", () => parseColor($("textHex").value)],
])
  on(field, "change", () =>
    transaction(() => {
      if (text()) text()[key] = read();
    }),
  );
on("applyAll", "click", () => {
  if (!item()) return;
  if (
    !confirm(
      "ใช้รูป ข้อความ และสีของชิ้นที่เลือกกับทุกชิ้นในหน้านี้? ตำแหน่งและขนาดแต่ละชิ้นจะคงเดิม",
    )
  )
    return;
  transaction(() => {
    const source = clone(item());
    for (const a of pg().items) {
      a.background = source.background;
      a.image = clone(source.image);
      a.texts = source.texts.map((t) => ({
        ...t,
        x: (t.x / source.outer) * a.outer,
        y: (t.y / source.outer) * a.outer,
      }));
    }
  });
});
on("styleTarget", "change", syncStyle);
for (const [field, key, read] of [
  ["lineColor", "color", () => $("lineColor").value],
  ["lineWidth", "width", () => dimRead("lineWidth")],
  ["lineOpacity", "opacity", () => Number($("lineOpacity").value)],
  ["lineDash", "dash", () => $("lineDash").value],
  ["markSize", "size", () => dimRead("markSize")],
  ["markOffset", "offset", () => dimRead("markOffset")],
  ["linePreview", "preview", () => $("linePreview").checked],
  ["lineExport", "export", () => $("lineExport").checked],
])
  on(field, "change", () =>
    transaction(() => {
      project.styles[$("styleTarget").value][key] = read();
    }),
  );
for (const k of ["cropMarks", "registration"])
  on(k, "change", () =>
    transaction(() => {
      project[k] = $(k).checked;
    }),
  );
on("save", "click", async () => {
  validateProject(project);
  await saveQueue;
  download(
    `${project.name.replace(/[^\p{L}\p{N}_-]/gu, "_") || "badge"}.json`,
    JSON.stringify(project),
    "application/json",
  );
  status("ดาวน์โหลดไฟล์โปรเจกต์แล้ว เก็บไฟล์นี้เพื่อเปิดแก้ไขครั้งหน้า");
});
on("open", "click", () => $("projectFile").click());
on("projectFile", "change", async () => {
  const f = $("projectFile").files[0];
  if (!f) return;
  if (f.size > 50 * 1024 * 1024) throw Error("โปรเจกต์เกิน 50 MB");
  const raw = JSON.parse(await f.text()),
    p = migrate(raw);
  if (raw.version === 1) {
    for (
      let n = 0;
      n < (raw.items?.length || 0) && n < p.pages[0].items.length;
      n++
    ) {
      const source = raw.items[n]?.image;
      if (!source) continue;
      if (!/^data:image\/(png|jpeg|webp);base64,/.test(source))
        throw Error("รูปในไฟล์เก่าไม่รองรับ กรุณาแปลงเป็น PNG/JPEG/WebP ก่อน");
      const image = new Image();
      image.src = source;
      await image.decode();
      const key = id();
      p.assets[key] = {
        name: "รูปจากโปรเจกต์เดิม",
        data: source,
        width: image.naturalWidth,
        height: image.naturalHeight,
      };
      p.pages[0].items[n].image = {
        asset: key,
        fit: "cover",
        scale: 1,
        dx: 0,
        dy: 0,
        rotation: 0,
      };
    }
    validateProject(p);
  }
  if (confirm("เปิดไฟล์นี้แทนโปรเจกต์ปัจจุบัน? งานเดิมย้อนกลับได้"))
    switchProject(p);
  $("projectFile").value = "";
});
async function refreshLayouts() {
  layoutRecords = await store.list("layout:");
  $("layouts").innerHTML =
    '<option value="">เลือกเลย์เอาต์</option>' +
    layoutRecords
      .map((r, i) => `<option value="${i}">${esc(r.value.name)}</option>`)
      .join("");
}
on("saveLayout", "click", async () => {
  const name = prompt("ตั้งชื่อเลย์เอาต์");
  if (!name?.trim()) return;
  await store.put("layout:" + id(), {
    name: name.trim(),
    page: layoutSnapshot(pg()),
  });
  await refreshLayouts();
  status("บันทึกเลย์เอาต์ในเบราว์เซอร์แล้ว");
});
on("loadLayout", "click", () => {
  if ($("layouts").value === "") throw Error("กรุณาเลือกเลย์เอาต์");
  const saved = layoutRecords[Number($("layouts").value)].value.page,
    target = $("layoutTarget").value;
  if (
    target === "current" &&
    !confirm(
      "แทนการจัดวางหน้าปัจจุบันด้วยเลย์เอาต์นี้? ขนาดกระดาษจะเปลี่ยนตามที่บันทึก",
    )
  )
    return;
  transaction(() => {
    const p = clone(saved);
    p.id = id();
    for (const a of p.items) a.id = id();
    if (target === "new") {
      project.pages.push(p);
      pageIndex = project.pages.length - 1;
    } else {
      const previous = pg().items;
      p.items.forEach((a, i) => {
        if (previous[i]) {
          a.image = clone(previous[i].image);
          a.texts = clone(previous[i].texts);
          a.background = previous[i].background;
        }
      });
      project.pages[pageIndex] = p;
    }
    selected = 0;
  }, "โหลดเลย์เอาต์แล้ว ไม่มีการย่อขนาดชิ้นงาน");
});
const ready = [
  {
    title: "เข็มกลัด 58 mm • A4",
    face: 58,
    outer: 70,
    type: "round",
    category: "ขนาดมาตรฐาน",
  },
  {
    title: "เข็มกลัด 68 mm • A4",
    face: 68,
    outer: 78,
    type: "round",
    category: "ขนาดที่ใช้บ่อย",
  },
  {
    title: "เข็มกลัด 73 mm • A4",
    face: 73,
    outer: 83,
    type: "round",
    category: "ขนาดที่เพิ่มใหม่",
  },
  {
    title: "แม่เหล็ก 50 × 50 mm",
    face: 50,
    outer: 50,
    type: "square",
    category: "แม่เหล็กสี่เหลี่ยม",
  },
  {
    title: "แม่เหล็ก 61 × 61 mm",
    face: 61,
    outer: 61,
    type: "square",
    category: "แม่เหล็กสี่เหลี่ยม",
  },
  {
    title: "แม่เหล็ก 63.5 × 63.5 mm",
    face: 63.5,
    outer: 63.5,
    type: "square",
    category: "แม่เหล็กสี่เหลี่ยม",
  },
  {
    title: "สติกเกอร์ 40 mm • A4",
    face: 40,
    outer: 40,
    type: "sticker",
    category: "พิมพ์และตัด",
  },
];
const designs = [
  {
    title: "งานแต่ง / ของชำร่วย",
    text: "ขอบคุณที่มาร่วมงาน",
    background: "#fff0ed",
    color: "#873e56",
    font: "serif",
  },
  {
    title: "วงดนตรี / ศิลปิน",
    text: "LIVE MUSIC",
    background: "#202333",
    color: "#ffcf66",
    font: "sans",
  },
  {
    title: "โรงเรียน / ห้องเรียน",
    text: "ชื่อของฉัน",
    background: "#e5f6f2",
    color: "#216457",
    font: "sans",
  },
  {
    title: "Save the Date",
    text: "SAVE THE DATE",
    background: "#f0edfc",
    color: "#554582",
    font: "serif",
  },
  {
    title: "ร้านค้า / งานขาย",
    text: "THANK YOU",
    background: "#fff3db",
    color: "#7a4e1e",
    font: "sans",
  },
];
async function library() {
  const list = await store.list("template:");
  $("readyTemplates").innerHTML =
    ready
      .map(
        (r, i) =>
          `<div class="card"><strong>${esc(r.title)}</strong><p>${r.category}</p><button data-ready="${i}">เริ่มงานขนาดนี้</button></div>`,
      )
      .join("") +
    designs
      .map(
        (d, i) =>
          `<div class="card" style="border-top:4px solid ${d.color}"><strong>${d.title}</strong><p>ดีไซน์พร้อมใช้ แก้ไขข้อความต่อได้</p><button data-design="${i}">ใช้กับชิ้นที่เลือก</button></div>`,
      )
      .join("");
  $("customTemplates").innerHTML = list.length
    ? list
        .map(
          (r, i) =>
            `<div class="card"><strong>${esc(r.value.name)}</strong><p>${r.value.pages.length} หน้า</p><button data-custom="${i}">เปิดเทมเพลต</button><button data-remove-template="${i}">ลบ</button></div>`,
        )
        .join("")
    : '<p class="muted">ยังไม่มีเทมเพลตส่วนตัว</p>';
  for (const b of $("readyTemplates").querySelectorAll("[data-ready]"))
    b.onclick = () => {
      if (!confirm("เริ่มโปรเจกต์จากเทมเพลตนี้? งานเดิมย้อนกลับได้")) return;
      const r = ready[Number(b.dataset.ready)],
        p = newProject();
      p.name = r.title;
      p.pages[0].items = gridItems(
        p.pages[0],
        newItem(r.type, r.face, r.outer),
      );
      switchProject(p);
      $("libraryDialog").close();
    };
  for (const b of $("readyTemplates").querySelectorAll("[data-design]"))
    b.onclick = () => {
      const d = designs[Number(b.dataset.design)];
      transaction(() => {
        const a = needItem();
        a.background = d.background;
        a.texts = [
          {
            text: d.text,
            size: 4,
            x: a.outer / 2,
            y: a.outer * 0.55,
            color: d.color,
            font: d.font,
            weight: "normal",
            rotation: 0,
          },
        ];
        layerIndex = 0;
      });
      $("libraryDialog").close();
    };
  for (const b of $("customTemplates").querySelectorAll("[data-custom]"))
    b.onclick = () => {
      if (confirm("เปิดเทมเพลตแทนโปรเจกต์ปัจจุบัน?")) {
        switchProject(list[Number(b.dataset.custom)].value);
        $("libraryDialog").close();
      }
    };
  for (const b of $("customTemplates").querySelectorAll(
    "[data-remove-template]",
  ))
    b.onclick = async () => {
      if (confirm("ลบเทมเพลตนี้?")) {
        await store.remove(list[Number(b.dataset.removeTemplate)].key);
        await library();
      }
    };
  $("libraryDialog").showModal();
}
on("library", "click", library);
on("saveTemplate", "click", async () => {
  const name = prompt("ชื่อเทมเพลต", project.name);
  if (!name?.trim()) return;
  const saved = clone(project);
  saved.name = name.trim();
  await store.put("template:" + id(), saved);
  status("บันทึกเทมเพลตส่วนตัวแล้ว เปิดได้จากปุ่มเทมเพลตด้านบน");
});
on("help", "click", () => $("helpDialog").showModal());
on("bulk", "click", () => $("bulkDialog").showModal());
on("csvFile", "change", async () => {
  if ($("csvFile").files[0])
    $("csvText").value = await $("csvFile").files[0].text();
});
on("downloadCSV", "click", () =>
  download(
    "badge-example.csv",
    "\uFEFFname,title,image\r\nสมชาย,ทีมงาน,\r\nสมหญิง,ผู้จัดงาน,\r\n",
    "text/csv;charset=utf-8",
  ),
);
on("applyBulk", "click", () => {
  const rows = parseCSV($("csvText").value);
  if (rows.length > 5000) throw Error("นำเข้าได้สูงสุด 5,000 แถว");
  const base = clone(item() || newItem());
  if (!base.texts.length)
    base.texts = [
      {
        text: "{{" + Object.keys(rows[0])[0] + "}}",
        size: 5,
        x: base.outer / 2,
        y: base.outer * 0.6,
        color: "#172033",
        font: "sans",
        weight: "normal",
        rotation: 0,
      },
    ];
  const missing = rows.filter(
    (r) =>
      r.image && !Object.values(project.assets).some((a) => a.name === r.image),
  );
  if (missing.length)
    throw Error(`ไม่พบรูป ${missing[0].image} กรุณาอัปโหลดรูปก่อน`);
  if (!confirm(`สร้าง ${rows.length} ชิ้นบนหน้าใหม่ โดยใช้ดีไซน์ชิ้นที่เลือก?`))
    return;
  transaction(() => {
    let page = null,
      capacity = 0,
      index = 0;
    for (const record of rows) {
      if (!page || index >= capacity) {
        page = clone(pg());
        page.id = id();
        page.items = gridItems(page, base);
        capacity = page.items.length;
        if (!capacity) throw Error("ชิ้นงานไม่พอดีกระดาษ");
        page.items = [];
        project.pages.push(page);
        index = 0;
      }
      const a = clone(base),
        positions = gridItems(page, base);
      a.id = id();
      a.x = positions[index].x;
      a.y = positions[index].y;
      a.texts = a.texts.map((t) => ({ ...t, text: mergeText(t.text, record) }));
      if (record.image) {
        const asset = Object.keys(project.assets).find(
          (k) => project.assets[k].name === record.image,
        );
        a.image = { asset, fit: "cover", scale: 1, dx: 0, dy: 0, rotation: 0 };
      }
      page.items.push(a);
      index++;
    }
    pageIndex = project.pages.length - 1;
    selected = 0;
  }, `สร้างงาน ${rows.length} ชิ้นแล้ว`);
  $("bulkDialog").close();
});
on("export", "click", () => {
  $("exportStatus").textContent = "";
  $("exportDialog").showModal();
});
on("doExport", "click", async () => {
  $("doExport").disabled = true;
  try {
    validateProject(project);
    const indices = pageIndices(
      $("exportPages").value === "range"
        ? $("pageRange").value
        : $("exportPages").value,
      project.pages.length,
      pageIndex,
    );
    if (
      indices.some((i) => productionWarnings(project, project.pages[i]).length)
    )
      throw Error("มีชิ้นงานทับกันหรือเกินพื้นที่ กรุณาแก้ก่อนส่งออก");
    if (indices.every((i) => !project.pages[i].items.length))
      throw Error("ไม่มีชิ้นงานในหน้าที่เลือก");
    const dpi = Number($("dpi").value);
    if (!Number.isFinite(dpi) || dpi < 72 || dpi > 1200)
      throw Error("DPI ต้องอยู่ระหว่าง 72–1200");
    $("exportStatus").textContent = "กำลังสร้างไฟล์ กรุณารอสักครู่…";
    await exportFiles(project, indices, $("exportFormat").value, {
      dpi,
      transparent: $("transparent").checked,
      art: $("exportArt").checked,
      lines: $("exportLines").checked,
      marks: $("exportMarks").checked,
    });
    $("exportStatus").textContent =
      "สร้างไฟล์แล้ว ตรวจขนาดและพิมพ์ทดสอบก่อนผลิตจริง";
  } catch (e) {
    $("exportStatus").textContent = e.message;
  } finally {
    $("doExport").disabled = false;
  }
});
async function accountView() {
  const data = await (await api("/api/account")).json();
  username = data.user;
  $("accountState").textContent = username
    ? `เข้าสู่ระบบแล้ว: ${username}`
    : "ยังไม่ได้เข้าสู่ระบบ — งานในเครื่องยังใช้งานได้ตามปกติ";
  $("authForm").hidden = !!username;
  $("signedIn").hidden = !username;
  if (username) {
    const projects = await (await api("/api/projects")).json();
    $("serverProjects").innerHTML = projects.length
      ? projects
          .map(
            (p, i) =>
              `<div class="card"><strong>${esc(p.name)}</strong><p>${new Date(p.updated).toLocaleString("th-TH")}</p><button data-server-open="${i}">เปิด</button><button data-server-delete="${i}">ลบ</button></div>`,
          )
          .join("")
      : "<p>ยังไม่มีโปรเจกต์บนเซิร์ฟเวอร์</p>";
    for (const b of $("serverProjects").querySelectorAll("[data-server-open]"))
      b.onclick = async () => {
        try {
          const p = projects[Number(b.dataset.serverOpen)],
            data = await (await api("/api/projects/" + p.id)).json();
          if (confirm("เปิดโปรเจกต์นี้แทนงานปัจจุบัน?")) {
            switchProject(data);
            serverId = p.id;
            $("accountDialog").close();
          }
        } catch (e) {
          $("accountStatus").textContent = e.message;
        }
      };
    for (const b of $("serverProjects").querySelectorAll(
      "[data-server-delete]",
    ))
      b.onclick = async () => {
        try {
          const p = projects[Number(b.dataset.serverDelete)];
          if (confirm("ลบโปรเจกต์นี้บนเซิร์ฟเวอร์อย่างถาวร?")) {
            await api("/api/projects/" + p.id, { method: "DELETE" });
            if (serverId === p.id) serverId = null;
            await accountView();
          }
        } catch (e) {
          $("accountStatus").textContent = e.message;
        }
      };
  }
}
on("account", "click", async () => {
  $("accountStatus").textContent = "";
  $("accountDialog").showModal();
  try {
    await accountView();
  } catch (e) {
    $("accountStatus").textContent = e.message;
  }
});
for (const action of ["login", "register"])
  on(action, "click", async () => {
    try {
      await api("/api/" + action, {
        method: "POST",
        body: JSON.stringify({
          username: $("username").value,
          password: $("password").value,
        }),
      });
      $("password").value = "";
      serverId = null;
      $("accountStatus").textContent =
        action === "register" ? "สร้างบัญชีแล้ว" : "เข้าสู่ระบบแล้ว";
      await accountView();
    } catch (e) {
      $("accountStatus").textContent = e.message;
    }
  });
on("logout", "click", async () => {
  await api("/api/logout", { method: "POST" });
  serverId = null;
  await accountView();
});
async function serverSave(asNew = false) {
  try {
    validateProject(project);
    const pid = asNew || !serverId ? id() : serverId;
    await api("/api/projects/" + pid, {
      method: "PUT",
      body: JSON.stringify(project),
    });
    serverId = pid;
    $("accountStatus").textContent = "บันทึกบนเซิร์ฟเวอร์แล้ว";
    await accountView();
  } catch (e) {
    $("accountStatus").textContent = e.message;
  }
}
on("serverSave", "click", () => serverSave());
on("serverSaveAs", "click", () => serverSave(true));
window.addEventListener("beforeunload", (e) => {
  if (saving) {
    e.preventDefault();
    e.returnValue = "กำลังบันทึกโปรเจกต์";
  }
});
try {
  const saved = await store.get("autosave");
  if (saved) project = validateProject(saved);
  await refreshLayouts();
} catch (e) {
  $("saveStatus").textContent =
    "กู้คืนอัตโนมัติไม่สำเร็จ เปิดไฟล์ JSON สำรองได้";
}
const query = new URLSearchParams(location.search).get("template");
if (
  query &&
  (!(await store.get("autosave")) ||
    confirm("เปิดเทมเพลตจากลิงก์แทนงานปัจจุบัน?"))
) {
  const m = query.match(/^(44|57|58|59|68|73|75)-(a4|a3|letter)$/);
  if (m) {
    const size = Number(m[1]);
    project = newProject();
    const p = project.pages[0];
    [p.paper.width, p.paper.height] =
      m[2] === "a3"
        ? [297, 420]
        : m[2] === "letter"
          ? [215.9, 279.4]
          : [210, 297];
    p.items = gridItems(
      p,
      newItem("round", size, { 57: 67, 58: 70, 59: 69 }[size] || size + 10),
    );
  }
}
for (const k of Object.keys(inputUnits)) inputUnits[k] = project.unit;
render();
