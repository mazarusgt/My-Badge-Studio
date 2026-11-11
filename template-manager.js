import {
  clone,
  id,
  newProject,
  newItem,
  gridItems,
  layoutSnapshot,
  validateProject,
} from "./model.js";
import { esc, renderPage } from "./render.js";
import * as store from "./storage.js";
const $ = (id) => document.getElementById(id);
function paletteOf(project) {
  const a = project.pages[0]?.items[0];
  return {
    background: a?.background || "#ffffff",
    text: a?.texts[0]?.color || "#172033",
    line: project.styles.cut.color,
  };
}
function applyPalette(project, delta) {
  for (const page of project.pages)
    for (const a of page.items) {
      if (delta.background) a.background = delta.background;
      if (delta.text) for (const t of a.texts) t.color = delta.text;
    }
  if (delta.line) project.styles.cut.color = delta.line;
}
export function createTemplateManager({
  getProject,
  getPage,
  switchProject,
  applyDesign,
  refreshLayouts,
  status,
  onWorkspaceChange,
  onMetadataChange,
  applyLayout,
  ready,
  designs,
}) {
  let editing = null,
    records = new Map(),
    metadata = null;
  const dialog = document.createElement("dialog");
  dialog.id = "templateDetailsDialog";
  dialog.setAttribute("aria-labelledby", "templateDetailsTitle");
  dialog.innerHTML = `<form id="templateDetailsForm"><div class="dialoghead"><h2 id="templateDetailsTitle">รายละเอียดเทมเพลต</h2><button type="button" id="closeTemplateDetails" aria-label="ปิด">×</button></div><label>ชื่อ<input id="managedTemplateName" maxlength="200" required /></label><p class="hint">เปลี่ยนชื่อหรือชุดสีได้โดยไม่ต้องเริ่มงานใหม่ ช่องสีที่ไม่ได้แก้ไขจะคงเดิม</p><div class="template-palette"><label>สีพื้นชิ้นงาน<input type="color" id="managedBackground" /></label><label>สีข้อความ<input type="color" id="managedText" /></label><label>สีเส้นตัด<input type="color" id="managedLine" /></label></div><p id="templateDetailsStatus" role="status"></p><button id="saveTemplateDetails" class="primary wide" type="submit">บันทึกรายละเอียด</button></form>`;
  document.body.append(dialog);
  const safe = (fn) => async (e) => {
    try {
      await fn(e);
    } catch (error) {
      const target = dialog.open
        ? $("templateDetailsStatus")
        : $("libraryDialog").open
          ? $("libraryStatus")
          : $("editingHint");
      target.textContent = "ดำเนินการไม่สำเร็จ: " + error.message;
    }
  };
  async function seed() {
    if (await store.get("gallery-seeded-v2")) return;
    for (let i = 0; i < designs.length; i++) {
      const d = designs[i],
        p = newProject(),
        a = newItem();
      p.name = d.title;
      p.pages[0].items = [a];
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
      await store.put("gallery-design:" + i, p);
    }
    for (let i = 0; i < ready.length; i++) {
      const r = ready[i],
        p = newProject();
      p.name = r.title;
      p.pages[0].items = gridItems(
        p.pages[0],
        newItem(r.type, r.face, r.outer),
      );
      await store.put("gallery-layout:" + i, {
        name: r.title,
        page: layoutSnapshot(p.pages[0]),
        palette: paletteOf(p),
      });
    }
    await store.put("gallery-seeded-v2", true);
  }
  function toProject(record) {
    if (record.kind === "design") return clone(record.value);
    const p = newProject();
    p.name = record.value.name;
    p.pages = [clone(record.value.page)];
    p.assets = {};
    applyPalette(p, record.value.palette || {});
    return p;
  }
  function card(record, index) {
    const project = toProject(record),
      a = project.pages[0].items[0],
      name = record.value.name;
    const attr =
      record.kind === "design"
        ? record.personal
          ? "data-custom"
          : "data-design"
        : record.personal
          ? "data-saved-layout"
          : "data-ready";
    const page =
      record.kind === "design" && a
        ? {
            paper: {
              width: a.outer,
              height: a.outer,
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
            },
            items: [{ ...a, x: 0, y: 0 }],
          }
        : project.pages[0];
    const preview = `<div class="gallery-preview" aria-hidden="true" inert>${renderPage(project, page, { selectedIds: [], prefix: "gallery-" + record.key.replace(/[^a-z0-9-]/gi, "_") + "-" })}</div>`;
    return `<article class="card template-card">${preview}<strong>${esc(name)}</strong><p>${record.kind === "layout" ? project.pages[0].items.length + " ชิ้น • จัดวางบนกระดาษ" : project.pages.length + " หน้า • รูปและข้อความ"}</p><div class="template-card-actions"><button type="button" ${attr}="${index}" data-action="use" data-record="${esc(record.key)}">${record.kind === "layout" ? "ใช้การจัดวาง" : "ใช้ดีไซน์"}</button><button type="button" data-action="edit" data-record="${esc(record.key)}">แก้ไขบนแคนวาส</button><button type="button" data-action="metadata" data-record="${esc(record.key)}">ชื่อ / ชุดสี</button><button type="button" ${record.kind === "design" && record.personal ? `data-remove-template="${index}"` : ""} data-action="delete" data-record="${esc(record.key)}" class="danger">ลบ</button></div></article>`;
  }
  async function show() {
    const active =
      $("layoutGalleryTab")?.getAttribute("aria-selected") === "true"
        ? "layoutGalleryTab"
        : "designGalleryTab";
    await seed();
    await refreshLayouts();
    records = new Map();
    for (const [prefix, kind, personal] of [
      ["gallery-design:", "design", false],
      ["template:", "design", true],
      ["gallery-layout:", "layout", false],
      ["layout:", "layout", true],
    ])
      for (const row of await store.list(prefix))
        records.set(row.key, { ...row, kind, personal });
    const rows = [...records.values()];
    for (const [container, kind, personal] of [
      ["designTemplates", "design", false],
      ["customTemplates", "design", true],
      ["readyTemplates", "layout", false],
      ["savedLayoutTemplates", "layout", true],
    ]) {
      const filtered = rows.filter(
        (r) => r.kind === kind && r.personal === personal,
      );
      $(container).innerHTML = filtered.length
        ? filtered.map(card).join("")
        : '<p class="hint">ยังไม่มีรายการ • บันทึกงานปัจจุบันเพื่อเพิ่มเทมเพลตได้</p>';
    }
    if (!$("libraryDialog").open) {
      $("libraryDialog").showModal();
      $("designGalleryTab")?.click();
    } else $(active)?.click();
  }
  function paintEditing() {
    $("editingMode").hidden = !editing;
    if (!editing) return;
    $("editingTitle").textContent =
      `กำลังแก้ไข${editing.kind === "design" ? "ดีไซน์" : "เลย์เอาต์"}: ${editing.name}`;
    const dirty = JSON.stringify(getProject()) !== editing.baseline;
    $("editingHint").textContent = dirty
      ? "มีการเปลี่ยนแปลงที่ยังไม่บันทึก"
      : "บันทึกการเปลี่ยนแปลงล่าสุดแล้ว";
    $("saveTemplateEdits").disabled = !dirty;
  }
  async function beginEdit(record) {
    if (
      editing &&
      JSON.stringify(getProject()) !== editing.baseline &&
      !confirm("ออกจากเทมเพลตที่กำลังแก้ไขโดยไม่บันทึก?")
    )
      return;
    if (!confirm("เปิดเทมเพลตนี้บนแคนวาสเพื่อแก้ไข? งานปัจจุบันย้อนกลับได้"))
      return;
    const p = toProject(record);
    switchProject(p);
    editing = {
      ...record,
      name: record.value.name,
      baseline: JSON.stringify(getProject()),
    };
    $("libraryDialog").close();
    paintEditing();
    onWorkspaceChange(record.kind);
  }
  async function saveEditing() {
    if (!editing) return;
    const p = clone(getProject());
    validateProject(p);
    const name = p.name.trim() || editing.name;
    const value =
      editing.kind === "design"
        ? { ...p, name }
        : {
            name,
            page: layoutSnapshot(getPage()),
            palette: paletteOf({ ...p, pages: [getPage()] }),
          };
    await store.put(editing.key, value);
    editing.value = value;
    editing.name = name;
    editing.baseline = JSON.stringify(getProject());
    await refreshLayouts();
    paintEditing();
    status("บันทึกการแก้ไขเทมเพลตแล้ว");
  }
  async function use(record) {
    if (
      editing &&
      JSON.stringify(getProject()) !== editing.baseline &&
      !confirm("ออกจากการแก้ไขที่ยังไม่บันทึก?")
    )
      return;
    if (record.kind === "design" && !record.personal) {
      applyDesign(
        toProject(record).pages[0].items[0],
        toProject(record).assets,
      );
    } else if (record.kind === "layout" && record.personal) {
      if (!applyLayout(record)) return;
    } else {
      if (!confirm("เปิดเทมเพลตนี้แทนงานปัจจุบัน? งานเดิมย้อนกลับได้")) return;
      switchProject(toProject(record));
    }
    editing = null;
    paintEditing();
    $("libraryDialog").close();
  }
  function openDetails(record = null, kind = "design") {
    const project = record ? toProject(record) : clone(getProject()),
      palette = paletteOf(project);
    metadata = { record, kind: record?.kind || kind, palette };
    $("managedTemplateName").value = record?.value.name || project.name;
    $("managedBackground").value = palette.background;
    $("managedText").value = palette.text;
    $("managedLine").value = palette.line;
    $("templateDetailsTitle").textContent = record
      ? "ชื่อและชุดสีเทมเพลต"
      : `บันทึก${kind === "design" ? "ดีไซน์" : "เลย์เอาต์"}ใหม่`;
    $("templateDetailsStatus").textContent = "";
    dialog.showModal();
    $("managedTemplateName").focus();
  }
  $("closeTemplateDetails").onclick = () => dialog.close();
  $("templateDetailsForm").addEventListener(
    "submit",
    safe(async (e) => {
      e.preventDefault();
      const name = $("managedTemplateName").value.trim();
      if (!name) {
        $("templateDetailsStatus").textContent = "กรุณาระบุชื่อ";
        return;
      }
      $("saveTemplateDetails").disabled = true;
      try {
        const { record, kind, palette } = metadata,
          p = record ? toProject(record) : clone(getProject()),
          delta = {};
        for (const [key, id] of Object.entries({
          background: "managedBackground",
          text: "managedText",
          line: "managedLine",
        }))
          if ($(id).value !== palette[key]) delta[key] = $(id).value;
        applyPalette(p, delta);
        p.name = name;
        const value =
          kind === "design"
            ? p
            : {
                name,
                page: layoutSnapshot(record ? p.pages[0] : getPage()),
                palette: { ...palette, ...delta },
              };
        const key =
          record?.key ||
          `${kind === "design" ? "template:" : "layout:"}${id()}`;
        await store.put(key, value);
        if (editing?.key === key) {
          editing.name = name;
          editing.value = value;
          onMetadataChange(name, delta);
        }
        await refreshLayouts();
        dialog.close();
        await show();
        $(kind === "design" ? "designGalleryTab" : "layoutGalleryTab")?.click();
        $("libraryStatus").textContent = "บันทึกชื่อและชุดสีแล้ว";
        paintEditing();
      } finally {
        $("saveTemplateDetails").disabled = false;
      }
    }),
  );
  $("libraryDialog").addEventListener(
    "click",
    safe(async (e) => {
      const button = e.target.closest("[data-action][data-record]");
      if (!button) return;
      const record = records.get(button.dataset.record);
      if (!record) return;
      if (button.dataset.action === "use") await use(record);
      if (button.dataset.action === "edit") await beginEdit(record);
      if (button.dataset.action === "metadata") openDetails(record);
      if (
        button.dataset.action === "delete" &&
        confirm(`ลบ “${record.value.name}” ถาวร?`)
      ) {
        await store.remove(record.key);
        if (editing?.key === record.key) {
          editing = null;
          paintEditing();
        }
        await refreshLayouts();
        await show();
        $("libraryStatus").textContent = "ลบเทมเพลตแล้ว";
      }
    }),
  );
  $("saveTemplateEdits").addEventListener("click", safe(saveEditing));
  $("finishTemplateEdits").addEventListener("click", () => {
    if (
      editing &&
      JSON.stringify(getProject()) !== editing.baseline &&
      !confirm("จบการแก้ไขโดยไม่บันทึกลงเทมเพลต?")
    )
      return;
    editing = null;
    paintEditing();
  });
  return {
    show,
    paintEditing,
    openCreate: (kind) => openDetails(null, kind),
    resetEditing() {
      editing = null;
      paintEditing();
    },
  };
}
