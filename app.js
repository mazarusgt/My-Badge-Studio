import { createLiveLayout } from "./live-layout.js";
import { initSidebarResets } from "./sidebar-resets.js";
import { icon } from "./ui-icons.js";
import {
  createCanvasActions,
  createDeleteConfirmation,
} from "./canvas-actions.js";
import { spacingReport, allDesignsApplied } from "./workspace-state.js";
import {
  createPositionControls,
  configurePageControls,
} from "./position-controls.js";
import { createTemplateManager } from "./template-manager.js";
import { createBadgeEditor } from "./badge-editor.js";
import { ensureTextLayer, setBatchProperty } from "./batch.js";
import {
  initEditorControls,
  syncEditorControls,
  updatePresetButtons,
  revealControl,
} from "./editor-controls.js";
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
  layoutRecords = [];
let selectedIds = new Set(),
  selectionPage = null;
let liveLayout, sidebarResets;
let templateManager,
  positionControls,
  pageControls,
  badgeEditor,
  canvasActions,
  deleteConfirmation;
const inputUnits = {};
const selectedItems = () => pg().items.filter((a) => selectedIds.has(a.id));
const editItems = () => (selectedIds.size ? selectedItems() : [needItem()]);
function clearSelectedImages() {
  if (!selectedIds.size) return;
  transaction(
    () => setBatchProperty(selectedItems(), "image", null),
    `ลบรูปจาก ${selectedIds.size} ชิ้นแล้ว • ชิ้นงานยังอยู่`,
  );
}
function selectItems(indices) {
  selectedIds = new Set(
    indices.filter((i) => pg().items[i]).map((i) => pg().items[i].id),
  );
  selected = indices.at(-1) ?? -1;
  selectionPage = pg().id;
  layerIndex = 0;
}
function chooseItem(index, additive = false) {
  const indices = additive
    ? pg().items.flatMap((a, i) => (selectedIds.has(a.id) ? [i] : []))
    : [];
  const at = indices.indexOf(index);
  if (additive && at >= 0) indices.splice(at, 1);
  else indices.push(index);
  selectItems(indices);
}
function convertSelection(type) {
  if (!selectedItems().length) return;
  transaction(() => {
    for (const a of selectedItems()) {
      if (a.type === type) continue;
      const old = a.outer;
      a.type = type;
      a.face = presets[type][0];
      a.outer = a.face + (type === "round" ? 10 : 0);
      a.safe = Math.min(a.safe, a.face / 2);
      for (const t of a.texts) {
        t.x *= a.outer / old;
        t.y *= a.outer / old;
      }
    }
  }, `เปลี่ยนประเภท ${selectedIds.size} ชิ้นแล้ว • จัดเรียงอัตโนมัติได้หากชิ้นงานทับกัน`);
}
async function deleteSelection() {
  if (!selectedIds.size) return;
  const ids = new Set(selectedIds),
    pageId = pg().id;
  const labels = [
    ...new Set(
      selectedItems().map(
        (a) =>
          ({ round: "เข็มกลัด", square: "แม่เหล็ก", sticker: "สติกเกอร์" })[
            a.type
          ],
      ),
    ),
  ].join(" / ");
  if (
    !(await deleteConfirmation.ask(
      `ต้องการลบ${labels} ${ids.size} ชิ้นที่เลือกใช่หรือไม่?`,
    ))
  )
    return;
  if (pg().id !== pageId) {
    status("หน้ากระดาษเปลี่ยนแล้ว กรุณาเลือกชิ้นงานอีกครั้ง", true);
    return;
  }
  transaction(() => {
    pg().items = pg().items.filter((a) => !ids.has(a.id));
    selectItems([]);
  }, "ลบชิ้นที่เลือกแล้ว • Ctrl/Cmd+Z เพื่อย้อนกลับ");
}
function duplicateSelection() {
  const source = selectedItems();
  if (!source.length) return;
  transaction(() => {
    const copies = source.map((a) => ({
      ...clone(a),
      id: id(),
      x: a.x + 3,
      y: a.y + 3,
    }));
    const start = pg().items.length;
    pg().items.push(...copies);
    selectItems(copies.map((_, i) => start + i));
  }, "ทำสำเนาแล้ว • ลากย้ายหรือกดจัดเรียงอัตโนมัติ");
}
const pg = () => project.pages[pageIndex],
  item = () => pg().items[selected],
  text = () =>
    item()?.texts[layerIndex] ||
    selectedItems().find((a) => a.texts[layerIndex])?.texts[layerIndex];
const status = (message, error = false) => {
  $("status").textContent = message;
  $("status").hidden = !message;
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
  const previousSelection = {
    ids: new Set(selectedIds),
    selected,
    pageIndex,
    selectionPage,
  };
  try {
    fn();
    validateProject(project);
    undo.push(before);
    if (undo.length > 30) undo.shift();
    redo = [];
    render();
    autosave();
    if (message) status(message);
    return true;
  } catch (e) {
    project = before;
    selectedIds = previousSelection.ids;
    selected = previousSelection.selected;
    pageIndex = previousSelection.pageIndex;
    selectionPage = previousSelection.selectionPage;
    render();
    report(e);
    return false;
  }
}
function switchProject(p) {
  validateProject(p);
  templateManager?.resetEditing();
  transaction(() => {
    project = clone(p);
    pageIndex = 0;
    selected = 0;
    selectionPage = null;
    layerIndex = 0;
    serverId = null;
    for (const k of Object.keys(inputUnits)) inputUnits[k] = project.unit;
  }, "เปิดโปรเจกต์แล้ว");
}
function normalizeSelection() {
  pageIndex = Math.min(Math.max(0, pageIndex), project.pages.length - 1);
  selected = Math.min(selected, pg().items.length - 1);
  if (
    selectionPage !== pg().id ||
    (selected >= 0 && !selectedIds.has(item()?.id))
  ) {
    selectedIds = new Set(item() ? [item().id] : []);
    selectionPage = pg().id;
  }
  selectedIds = new Set(
    [...selectedIds].filter((id) => pg().items.some((a) => a.id === id)),
  );
  layerIndex = Math.min(
    Math.max(0, layerIndex),
    Math.max(0, ...selectedItems().map((a) => a.texts.length - 1)),
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
  for (const k of ["cols", "rows"]) {
    setValue(k, l[k]);
    $(k).disabled = l.mode === "staggered";
  }
  const selectedTab = $("selectionToolsTab");
  if (selectedTab)
    selectedTab.querySelector("span").textContent =
      `ชิ้นที่เลือก (${selectedIds.size})`;
  const paperMatch = [...$("paper").options].find(
    (o) => o.value === `${p.width},${p.height}`,
  );
  setValue("paper", paperMatch ? paperMatch.value : "custom");
  $("selection").textContent = a
    ? `ชิ้นที่ ${selected + 1} / ${pg().items.length}`
    : "หน้านี้ยังไม่มีชิ้นงาน";
  $("selectionCount").textContent = selectedIds.size
    ? `เลือก ${selectedIds.size} จาก ${pg().items.length} ชิ้น`
    : "ยังไม่ได้เลือกชิ้นงาน";
  $("selection").textContent =
    selectedIds.size > 1
      ? `เลือก ${selectedIds.size} ชิ้น • ประเภทและขนาดใช้กับทุกชิ้นที่เลือก`
      : $("selection").textContent;
  $("designSelection").textContent =
    selectedIds.size > 1
      ? `กำลังแก้ไข ${selectedIds.size} ชิ้นพร้อมกัน • ทุกการปรับมีผลกับชิ้นที่เลือก`
      : a
        ? `กำลังแก้ไขชิ้นที่ ${selected + 1}`
        : "คลิกชิ้นงานบนกระดาษเพื่อเริ่มแก้ไข";
  for (const id of [
    "batchRound",
    "batchSquare",
    "batchSticker",
    "duplicateItem",
    "deleteItem",
  ])
    $(id).disabled = !selectedIds.size;
  const types = new Set(selectedItems().map((a) => a.type));
  $("type").querySelector('option[value="mixed"]')?.remove();
  if (types.size > 1)
    $("type").insertAdjacentHTML(
      "afterbegin",
      '<option value="mixed" disabled>หลายประเภท</option>',
    );
  const design = a || newItem();
  setValue("type", types.size > 1 ? "mixed" : design.type);
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
  const im = design.image || selectedItems().find((a) => a.image)?.image;
  setValue("imageFit", im?.fit || "cover");
  setValue("imageScale", Number(((im?.scale || 1) * 100).toPrecision(12)));
  dimValue("imageX", im?.dx || 0);
  dimValue("imageY", im?.dy || 0);
  setValue("imageRotation", im?.rotation || 0);
  const textDesign = design.texts.length
    ? design
    : selectedItems().find((a) => a.texts.length) || design;
  $("textLayer").innerHTML = textDesign.texts.length
    ? textDesign.texts
        .map(
          (t, i) =>
            `<option value="${i}">${i + 1}. ${esc(t.text.slice(0, 25) || "(ข้อความว่าง)")}</option>`,
        )
        .join("")
    : '<option value="">ยังไม่มีข้อความ</option>';
  setValue("textLayer", textDesign.texts.length ? String(layerIndex) : "");
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
  updatePresetButtons();
  syncEditorControls();
  positionControls?.sync();
  sidebarResets?.sync();
  liveLayout?.sync();
  pageControls?.sync(pg(), inputUnits.width || project.unit);
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
  $("sheet").innerHTML = renderPage(project, pg(), {
    selected,
    selectedIds: [...selectedIds],
  });
  zoom();
  for (const button of document.querySelectorAll("[data-layout-mode]"))
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.layoutMode === (pg().layout.mode || "grid")),
    );
  $("count").textContent =
    `${pg().items.length} ชิ้น · หน้า ${pageIndex + 1} / ${project.pages.length}`;
  canvasActions?.sync();
  const warnings = productionWarnings(project, pg());
  status(
    warnings.filter((w) => !w.includes("ทับกัน")).join(" • "),
    !!warnings.length,
  );
  paintSpacingWarning(pg());
  const applied = allDesignsApplied(pg());
  $("applyAll").setAttribute("aria-pressed", String(applied));
  $("applyAll").querySelector("span").textContent = applied
    ? "ใช้ดีไซน์ร่วมกันทั้งหน้าแล้ว"
    : "ใช้ดีไซน์กับทุกชิ้นในหน้านี้";
  templateManager?.paintEditing();
}
function paintSpacingWarning(page) {
  const spacing = spacingReport(page);
  $("spacingWarning").hidden = !spacing.crowded;
  $("canvas").classList.toggle("has-spacing-warning", spacing.crowded);
  $("spacingTitle").textContent = spacing.overlaps
    ? "มีชิ้นงานทับกัน"
    : spacing.close
      ? "ชิ้นงานอยู่ชิดกันเกินไป"
      : "ชิ้นงานแน่นเกินไป";
  $("spacingDetails").textContent =
    (spacing.overlaps
      ? `พบการทับกัน ${spacing.overlaps} คู่ • `
      : spacing.close
        ? `มี ${spacing.close} คู่ที่ห่างกันน้อยกว่า 0.8 mm • `
        : "พื้นที่ใช้งานเกิน 82% • ") +
    "ควรลบบางชิ้น เพิ่มระยะห่าง หรือปรับการจัดวางเพื่อให้ผลิตได้เรียบร้อย";
}
function previewPosition(id, value) {
  if (!item()) return;
  const page = clone(pg()),
    mm = value * units[inputUnits[id] || project.unit];
  const targets = page.items.filter((a) => selectedIds.has(a.id));
  for (const a of targets) {
    if (id === "itemX") a.x = Math.max(0, a.x + mm - item().x);
    if (id === "itemY") a.y = Math.max(0, a.y + mm - item().y);
    if (id === "imageX" && a.image) a.image.dx = mm;
    if (id === "imageY" && a.image) a.image.dy = mm;
    if (id === "textX" && a.texts[layerIndex]) a.texts[layerIndex].x = mm;
    if (id === "textY" && a.texts[layerIndex]) a.texts[layerIndex].y = mm;
  }
  $("sheet").innerHTML = renderPage(project, page, {
    selected,
    selectedIds: [...selectedIds],
  });
  zoom();
}
function needItem() {
  if (!item()) {
    pg().items.push(newItem());
    selected = pg().items.length - 1;
  }
  return item();
}
function resetSidebarSetting(id) {
  const defaults = newProject(),
    p = defaults.pages[0],
    style = defaults.styles[$("styleTarget").value];
  if (id === "face" || id === "outer") {
    transaction(() => {
      for (const target of editItems()) {
        const face =
          target.type === "round" ? 68 : target.type === "square" ? 50 : 40;
        target.face = face;
        target.outer = face + (target.type === "round" ? 10 : 0);
      }
    }, "คืนค่าขนาดเริ่มต้นตามประเภทชิ้นงานแล้ว");
    return;
  }
  const values = {
    type: "round",
    preset:
      item()?.type === "square"
        ? "50"
        : item()?.type === "sticker"
          ? "40"
          : "68",
    safe: 3,
    notes: "",
    paper: "210,297",
    ...p.paper,
    ...p.layout,
    pageUnit: "mm",
    styleTarget: "cut",
    lineColor: style.color,
    lineWidth: style.width,
    lineOpacity: style.opacity,
    lineDash: style.dash,
    markSize: style.size,
    markOffset: style.offset,
    linePreview: style.preview,
    lineExport: style.export,
    cropMarks: false,
    registration: false,
    layouts: "",
    layoutTarget: "current",
  };
  if (!(id in values)) return;
  const input = $(id);
  if (input.type === "checkbox") input.checked = values[id];
  else
    input.value = input.hasAttribute("data-dim")
      ? String(values[id] / units[inputUnits[id] || project.unit])
      : String(values[id]);
  input.dispatchEvent(new Event("change", { bubbles: true }));
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
        const value = dimRead(k);
        if (target === needItem && selectedIds.size)
          for (const a of selectedItems()) a[k] = value;
        else target()[k] = value;
      }),
    );
}
bindDim(["face", "outer", "safe"], needItem);
bindDim(
  ["width", "height", "top", "right", "bottom", "left"],
  () => pg().paper,
);

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
    setBatchProperty(editItems(), "notes", $("notes").value);
  }),
);
on("type", "change", () => convertSelection($("type").value));
on("preset", "change", () => {
  if ($("preset").value === "custom") return;
  transaction(() => {
    const f = Number($("preset").value);
    for (const a of selectedItems()) {
      a.face = f;
      a.outer =
        a.type === "round" ? { 57: 67, 58: 70, 59: 69 }[f] || f + 10 : f;
      a.safe = Math.min(a.safe, f / 2);
    }
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
on("duplicateItem", "click", duplicateSelection);
on("deleteItem", "click", deleteSelection);
for (const [button, type] of [
  ["batchRound", "round"],
  ["batchSquare", "square"],
  ["batchSticker", "sticker"],
])
  on(button, "click", () => convertSelection(type));
on("selectAll", "click", () => {
  selectItems(pg().items.map((_, i) => i));
  render();
});
on("clearSelection", "click", () => {
  selectItems([]);
  render();
});
for (const button of document.querySelectorAll("[data-layout-mode]"))
  button.addEventListener("click", () =>
    transaction(() => {
      pg().layout.mode = button.dataset.layoutMode;
      packItems(pg());
    }, "ปรับรูปแบบและจัดเรียงชิ้นงานแล้ว"),
  );
on("autoArrange", "click", () => liveLayout.arrange());
on("itemX", "change", () =>
  transaction(() => {
    const dx = dimRead("itemX") - needItem().x;
    for (const a of editItems()) a.x = Math.max(0, a.x + dx);
  }),
);
on("itemY", "change", () =>
  transaction(() => {
    const dy = dimRead("itemY") - needItem().y;
    for (const a of editItems()) a.y = Math.max(0, a.y + dy);
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
    e.target.closest('input,textarea,select,[contenteditable="true"]') ||
    document.querySelector("dialog[open]") ||
    e.isComposing
  )
    return;
  const mod = e.ctrlKey || e.metaKey;
  let action;
  if (mod && e.code === "KeyZ")
    action = () => $(e.shiftKey ? "redo" : "undo").click();
  else if (mod && e.code === "KeyD") action = duplicateSelection;
  else if (mod && e.shiftKey && e.code === "KeyS")
    action = () => convertSelection("square");
  else if (mod && e.shiftKey && e.code === "KeyC")
    action = () => convertSelection("round");
  else if (mod && e.code === "KeyA")
    action = () => {
      selectItems(pg().items.map((_, i) => i));
      render();
    };
  else if (mod && e.shiftKey && e.key === "Delete")
    action = clearSelectedImages;
  else if (!mod && e.code === "KeyE") action = () => badgeEditor?.open();
  else if (e.key === "Delete" || e.key === "Backspace")
    action = deleteSelection;
  else if (e.key === "Escape")
    action = () => {
      selectItems([]);
      render();
    };
  if (action) {
    e.preventDefault();
    if (!e.repeat) action();
  }
});
on("pageSelect", "change", () => {
  pageIndex = Number($("pageSelect").value);
  selected = 0;
  selectionPage = null;
  layerIndex = 0;
  render();
});
on("prevPage", "click", () => {
  if (pageIndex > 0) {
    pageIndex--;
    selected = 0;
    selectionPage = null;
    render();
  }
});
on("nextPage", "click", () => {
  if (pageIndex < project.pages.length - 1) {
    pageIndex++;
    selected = 0;
    selectionPage = null;
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
    selectionPage = null;
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
    selectionPage = null;
  }),
);
on("deletePage", "click", () => {
  if (project.pages.length > 1 && confirm("ลบหน้าปัจจุบันพร้อมงานในหน้านี้?"))
    transaction(() => {
      project.pages.splice(pageIndex, 1);
      selected = 0;
      selectionPage = null;
    });
});
on("zoom", "change", zoom);
window.addEventListener("resize", zoom);
new ResizeObserver(zoom).observe($("canvas"));
document.fonts.ready.then(zoom);
on("sheet", "keydown", (e) => {
  const g = e.target.closest("[data-slot]");
  if (g && ["Enter", " "].includes(e.key)) {
    e.preventDefault();
    chooseItem(Number(g.dataset.slot), e.shiftKey);
    render();
    canvasActions?.show();
    $("sheet").querySelector(`[data-slot="${g.dataset.slot}"]`)?.focus();
  }
});
let gesture;
const marquee = document.createElement("div");
marquee.className = "selection-marquee";
marquee.hidden = true;
document.body.append(marquee);
function canvasPoint(x, y) {
  return new DOMPoint(x, y).matrixTransform(
    $("sheet").querySelector("svg").getScreenCTM().inverse(),
  );
}
$("canvas").addEventListener("pointerdown", (e) => {
  if (
    e.button !== 0 ||
    e.target.closest("button,input,select") ||
    (e.pointerType === "touch" && !e.target.closest("[data-slot]"))
  )
    return;
  const g = e.target.closest("[data-slot]");
  const index = g ? Number(g.dataset.slot) : null;
  const move = $("moveMode").checked && index !== null && !e.shiftKey;
  if (move && !selectedIds.has(pg().items[index].id)) {
    chooseItem(index);
    render();
  }
  gesture = {
    pointer: e.pointerId,
    x: e.clientX,
    y: e.clientY,
    index,
    add: e.shiftKey,
    move,
    initial: new Set(selectedIds),
    start: canvasPoint(e.clientX, e.clientY),
    positions: selectedItems().map((a) => ({ id: a.id, x: a.x, y: a.y })),
    moved: false,
  };
  $("canvas").setPointerCapture(e.pointerId);
  e.preventDefault();
});
$("canvas").addEventListener("pointermove", (e) => {
  if (!gesture || gesture.pointer !== e.pointerId) return;
  const d = gesture;
  d.moved ||= Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4;
  if (!d.moved) return;
  if (d.move) {
    const p = canvasPoint(e.clientX, e.clientY);
    d.dx = p.x - d.start.x;
    d.dy = p.y - d.start.y;
    for (const a of d.positions) {
      const i = pg().items.findIndex((v) => v.id === a.id);
      $("sheet")
        .querySelector(`[data-slot="${i}"]`)
        ?.setAttribute("transform", `translate(${a.x + d.dx} ${a.y + d.dy})`);
    }
  } else {
    const x = Math.min(d.x, e.clientX),
      y = Math.min(d.y, e.clientY),
      w = Math.abs(e.clientX - d.x),
      h = Math.abs(e.clientY - d.y);
    Object.assign(marquee.style, {
      left: x + "px",
      top: y + "px",
      width: w + "px",
      height: h + "px",
    });
    marquee.hidden = false;
    const a = canvasPoint(x, y),
      b = canvasPoint(x + w, y + h);
    selectedIds = new Set(d.add ? d.initial : []);
    pg().items.forEach((item) => {
      if (
        item.x <= b.x &&
        item.x + item.outer >= a.x &&
        item.y <= b.y &&
        item.y + item.outer >= a.y
      )
        selectedIds.add(item.id);
    });
    selected = pg().items.findIndex((a) => selectedIds.has(a.id));
    render();
  }
});
function endGesture(e, cancel = false) {
  if (!gesture || gesture.pointer !== e.pointerId) return;
  const d = gesture;
  gesture = null;
  marquee.hidden = true;
  if ($("canvas").hasPointerCapture(e.pointerId))
    $("canvas").releasePointerCapture(e.pointerId);
  if (cancel) {
    selectedIds = d.initial;
    selected = pg().items.findIndex((a) => selectedIds.has(a.id));
    render();
    return;
  }
  if (d.moved && d.move)
    transaction(() => {
      for (const pos of d.positions) {
        const a = pg().items.find((a) => a.id === pos.id);
        a.x = Math.max(0, pos.x + d.dx);
        a.y = Math.max(0, pos.y + d.dy);
      }
    });
  else if (!d.moved) {
    if (d.index !== null) chooseItem(d.index, d.add);
    else if (!d.add) selectItems([]);
    render();
    if (d.index !== null && selectedIds.size) canvasActions?.show();
  }
}
$("canvas").addEventListener("pointerup", (e) => endGesture(e));
$("canvas").addEventListener("pointercancel", (e) => endGesture(e, true));
$("canvas").addEventListener(
  "wheel",
  (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const canvas = $("canvas"),
      before = $("sheetWrap").getBoundingClientRect();
    const old =
      $("sheet").getBoundingClientRect().width /
      ((pg().paper.width * 96) / 25.4);
    const scale = Math.max(
      0.1,
      Math.min(
        4,
        old * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.035 : 0.002)),
      ),
    );
    let option = $("zoom").querySelector("[data-wheel-zoom]");
    if (!option) {
      option = document.createElement("option");
      option.dataset.wheelZoom = "true";
      $("zoom").append(option);
    }
    option.value = String(scale);
    option.textContent = `${Math.round(scale * 100)}%`;
    $("zoom").value = option.value;
    const x = (e.clientX - before.left) / old,
      y = (e.clientY - before.top) / old;
    zoom();
    const after = $("sheetWrap").getBoundingClientRect();
    canvas.scrollLeft += after.left + x * scale - e.clientX;
    canvas.scrollTop += after.top + y * scale - e.clientY;
  },
  { passive: false },
);
async function importImages(files) {
  const accepted = [...files];
  if (!accepted.length) return;
  const importPage = pg().id,
    importSelection = [...selectedIds].join(",");
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
  if (pg().id !== importPage || [...selectedIds].join(",") !== importSelection)
    throw Error("การเลือกชิ้นงานเปลี่ยนระหว่างโหลดรูป กรุณาเลือกไฟล์อีกครั้ง");
  transaction(() => {
    if (selectedIds.size) {
      const assets = loaded.map((data) => {
        const key = id();
        project.assets[key] = data;
        return key;
      });
      selectedItems().forEach((a, i) => {
        a.image = {
          asset: assets[i % assets.length],
          scale: 1,
          dx: 0,
          dy: 0,
          rotation: 0,
          fit: "cover",
        };
      });
      return;
    }
    if (selected < 0) {
      needItem();
    }
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
on("clearImage", "click", clearSelectedImages);
for (const [field, key, read] of [
  ["imageFit", "fit", () => $("imageFit").value],
  ["imageScale", "scale", () => Number($("imageScale").value) / 100],
  ["imageX", "dx", () => dimRead("imageX")],
  ["imageY", "dy", () => dimRead("imageY")],
  ["imageRotation", "rotation", () => Number($("imageRotation").value)],
])
  on(field, "change", () =>
    transaction(() => {
      const value = read();
      const source = clone(
        item()?.image || selectedItems().find((a) => a.image)?.image,
      );
      for (const a of editItems()) {
        if (!a.image && source) a.image = clone(source);
        if (a.image) a.image[key] = value;
      }
    }),
  );
for (const field of ["background", "backgroundHex"])
  on(field, "change", () =>
    transaction(() => {
      setBatchProperty(editItems(), "background", parseColor($(field).value));
    }),
  );
on("addText", "click", () =>
  transaction(() => {
    const targets = editItems();
    const index = Math.max(...targets.map((a) => a.texts.length));
    for (const a of targets) ensureTextLayer(a, index);
    layerIndex = index;
  }),
);
on("deleteText", "click", () =>
  transaction(() => {
    for (const a of editItems())
      if (a.texts[layerIndex]) a.texts.splice(layerIndex, 1);
  }),
);
on("textLayer", "change", () => {
  layerIndex = Number($("textLayer").value);
  syncForm();
});
on("textFront", "click", () =>
  transaction(() => {
    for (const a of editItems())
      if (a.texts[layerIndex]) a.texts.push(a.texts.splice(layerIndex, 1)[0]);
    layerIndex = Math.max(0, (item()?.texts.length || 1) - 1);
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
      const value = read(),
        source = clone(text()),
        sourceOuter = item()?.outer;
      for (const a of editItems()) {
        const layer =
          a.texts[layerIndex] ||
          ensureTextLayer(a, layerIndex, source, sourceOuter);
        layer[key] = value;
      }
    }),
  );
on("applyAll", "click", () => {
  if (!item()) return;
  if (allDesignsApplied(pg())) {
    transaction(() => {
      pg().designApplied = false;
    }, "ปิดสถานะดีไซน์ร่วมแล้ว การแก้ไขต่อไปใช้กับชิ้นที่เลือก");
    return;
  }
  if (
    !confirm(
      "ใช้รูป ข้อความ และสีของชิ้นที่เลือกกับทุกชิ้นในหน้านี้? ตำแหน่งและขนาดแต่ละชิ้นจะคงเดิม",
    )
  )
    return;
  transaction(() => {
    const source = clone(item());
    pg().designApplied = true;
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
function applyStoredLayout(saved, target, palette = null) {
  if (
    target === "current" &&
    !confirm(
      "แทนการจัดวางหน้าปัจจุบันด้วยเลย์เอาต์นี้? ขนาดกระดาษจะเปลี่ยนตามที่บันทึก",
    )
  )
    return false;
  return transaction(() => {
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
    if (palette) {
      for (const a of pg().items) {
        a.background = palette.background;
        for (const t of a.texts) t.color = palette.text;
      }
      project.styles.cut.color = palette.line;
    }
    selected = 0;
    selectionPage = null;
  }, "โหลดเลย์เอาต์แล้ว ไม่มีการย่อขนาดชิ้นงาน");
}
on("loadLayout", "click", () => {
  if ($("layouts").value === "") throw Error("กรุณาเลือกเลย์เอาต์");
  const record = layoutRecords[Number($("layouts").value)].value;
  return applyStoredLayout(
    record.page,
    $("layoutTarget").value,
    record.palette,
  );
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
templateManager = createTemplateManager({
  getProject: () => project,
  getPage: pg,
  switchProject,
  refreshLayouts,
  status,
  ready,
  designs,
  onMetadataChange: (name, delta) =>
    transaction(() => {
      project.name = name;
      for (const page of project.pages)
        for (const a of page.items) {
          if (delta.background) a.background = delta.background;
          if (delta.text) for (const t of a.texts) t.color = delta.text;
        }
      if (delta.line) project.styles.cut.color = delta.line;
    }),
  applyLayout: (record) =>
    applyStoredLayout(
      record.value.page,
      $("layoutTarget").value,
      record.value.palette,
    ),
  onWorkspaceChange: (kind) => {
    revealControl(kind === "design" ? "image" : "paper");
    if (kind === "design") badgeEditor.open();
    else
      document.querySelector(".workspace").scrollIntoView({ block: "nearest" });
  },
  applyDesign: (source, assets) =>
    transaction(() => {
      for (const [key, asset] of Object.entries(assets))
        project.assets[key] = clone(asset);
      for (const a of editItems()) {
        a.background = source.background;
        a.image = clone(source.image);
        a.texts = source.texts.map((t) => ({
          ...clone(t),
          x: (t.x * a.outer) / source.outer,
          y: (t.y * a.outer) / source.outer,
        }));
      }
    }, "ใช้ดีไซน์กับชิ้นที่เลือกแล้ว"),
});
async function library() {
  await templateManager.show();
}
on("library", "click", library);
on("saveTemplate", "click", () => {
  $("templateName").value = project.name;
  $("templateSaveStatus").textContent = "";
  $("templateSaveDialog").showModal();
  $("templateName").focus();
});
on("templateSaveForm", "submit", async (e) => {
  e.preventDefault();
  const name = $("templateName").value.trim();
  if (!name) {
    $("templateSaveStatus").textContent = "กรุณาตั้งชื่อเทมเพลต";
    return;
  }
  $("confirmSaveTemplate").disabled = true;
  try {
    const saved = clone(project);
    saved.name = name;
    await store.put("template:" + id(), saved);
    $("templateSaveDialog").close();
    await library();
    $("libraryStatus").textContent =
      `บันทึก “${name}” แล้ว • อยู่ในเทมเพลตของฉันด้านล่าง`;
    $("customTemplates").scrollIntoView({ block: "nearest" });
  } catch (e) {
    $("templateSaveStatus").textContent = "บันทึกไม่สำเร็จ: " + e.message;
  } finally {
    $("confirmSaveTemplate").disabled = false;
  }
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
    selectionPage = null;
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
initEditorControls();
positionControls = createPositionControls({
  getPage: pg,
  getItem: item,
  getUnit: (id) => units[inputUnits[id] || project.unit],
  preview: previewPosition,
  restore: render,
});
pageControls = configurePageControls({
  setUnit: (unit) => {
    $("unit").value = unit;
    $("unit").dispatchEvent(new Event("change", { bubbles: true }));
  },
  onOrientation: (orientation) => {
    if (pg().paper.width <= pg().paper.height !== (orientation === "portrait"))
      $("rotate").click();
  },
  onCenter: () =>
    transaction(() => {
      if (!pg().items.length) return;
      const p = pg().paper,
        minX = Math.min(...pg().items.map((a) => a.x)),
        minY = Math.min(...pg().items.map((a) => a.y)),
        maxX = Math.max(...pg().items.map((a) => a.x + a.outer)),
        maxY = Math.max(...pg().items.map((a) => a.y + a.outer));
      if (
        maxX - minX > p.width - p.left - p.right ||
        maxY - minY > p.height - p.top - p.bottom
      )
        throw Error("ชิ้นงานไม่พอดีพื้นที่ กรุณาจัดเรียงหรือลบบางชิ้นก่อน");
      for (const a of pg().items) {
        a.x += p.left + (p.width - p.left - p.right - (maxX - minX)) / 2 - minX;
        a.y += p.top + (p.height - p.top - p.bottom - (maxY - minY)) / 2 - minY;
      }
    }, "จัดชิ้นงานให้อยู่กลางหน้าแล้ว"),
});
liveLayout = createLiveLayout({
  notify: () => status("จัดเรียงชิ้นงานทั้งหมดแล้ว • คงขนาดและดีไซน์เดิม"),
  getPage: pg,
  readGap: dimRead,
  preview: (page) => {
    paintSpacingWarning(page);
    $("sheet").innerHTML = renderPage(project, page, {
      selected,
      selectedIds: [...selectedIds],
    });
    zoom();
  },
  commit: (page) =>
    transaction(() => {
      pg().layout = clone(page.layout);
      const positions = new Map(
        page.items.map((a) => [a.id, { x: a.x, y: a.y }]),
      );
      for (const a of pg().items) Object.assign(a, positions.get(a.id));
    }, "จัดเรียงชิ้นงานทั้งหมดแล้ว • คงขนาดและดีไซน์เดิม"),
});
sidebarResets = initSidebarResets({ reset: resetSidebarSetting });
badgeEditor = createBadgeEditor({
  getProject: () => project,
  getItem: item,
  getSelectionCount: () => selectedIds.size,
  getTemplates: () => templateManager.designOptions(),
  getEditingContext: () => templateManager.editingContext(),
  onSave: async (draft, assets, styles, meta) => {
    if (
      !transaction(() => {
        if (draft.image)
          project.assets[draft.image.asset] = clone(assets[draft.image.asset]);
        project.styles = styles;
        if (meta?.name) project.name = meta.name;
        for (const a of editItems()) {
          a.background = draft.background;
          a.image = clone(draft.image);
          a.texts = draft.texts.map((t) => ({
            ...clone(t),
            x: (t.x * a.outer) / draft.outer,
            y: (t.y * a.outer) / draft.outer,
          }));
          if (a.image) {
            a.image.dx *= a.outer / draft.outer;
            a.image.dy *= a.outer / draft.outer;
          }
        }
      }, "บันทึกดีไซน์ให้ชิ้นที่เลือกแล้ว")
    )
      throw Error("บันทึกไม่สำเร็จ กรุณาตรวจค่าที่ปรับ");
    if (meta?.name) await templateManager.saveCurrentEditing();
  },
});
deleteConfirmation = createDeleteConfirmation();
canvasActions = createCanvasActions({
  getSheetRect: () => $("sheetWrap").getBoundingClientRect(),
  getCanvasRect: () => $("canvas").getBoundingClientRect(),
  getAnchor: () =>
    item()
      ? $("sheet")
          .querySelector(`[data-slot="${selected}"]`)
          ?.getBoundingClientRect()
      : null,
  onEdit: () => badgeEditor.open(),
  onDuplicate: duplicateSelection,
  onDelete: deleteSelection,
});
on("fixSpacing", "click", () => $("autoArrange").click());
for (const [gallery, kind] of [
  ["designGallery", "design"],
  ["layoutGallery", "layout"],
]) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "gallery-add action-icon";
  button.id = "create" + (kind === "design" ? "Design" : "Layout") + "Template";
  button.innerHTML = icon("plus");
  const addLabel =
    kind === "design" ? "เพิ่มดีไซน์เข็มกลัด" : "เพิ่มเทมเพลตจัดวาง";
  button.title = addLabel;
  button.setAttribute("aria-label", addLabel);
  button.addEventListener("click", () => templateManager.openCreate(kind));
  const heading = $(gallery).querySelector("h3");
  heading.textContent = kind === "design" ? "ดีไซน์เข็มกลัด" : "เทมเพลตจัดวาง";
  const headingRow = document.createElement("div");
  headingRow.className = "gallery-heading";
  heading.before(headingRow);
  headingRow.append(heading, button);
}
for (const k of Object.keys(inputUnits)) inputUnits[k] = project.unit;
render();

// Keep section shortcuts usable when a settings group is collapsed.
for (const link of document.querySelectorAll(".workspace-nav a")) {
  link.addEventListener("click", (event) => {
    const target = document.querySelector(link.getAttribute("href"));
    if (!target) return;
    event.preventDefault();
    if (target instanceof HTMLDetailsElement) target.open = true;
    const control = target.querySelector("summary, input, select, button");
    target.scrollIntoView({ block: "start" });
    control?.focus({ preventScroll: true });
  });
}

on("closeTemplateSave", "click", () => $("templateSaveDialog").close());
