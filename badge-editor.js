import { units } from "./geometry.js";
import { icon } from "./ui-icons.js";
import { clone, id } from "./model.js";
import { renderPage } from "./render.js";
import { defaultText } from "./batch.js";
const $ = (id) => document.getElementById(id);
export function createBadgeEditor({
  getProject,
  getItem,
  getSelectionCount,
  getTemplates,
  getEditingContext,
  onSave,
}) {
  const modal = document.createElement("dialog");
  modal.id = "badgeEditor";
  modal.className = "badge-editor";
  modal.setAttribute("aria-labelledby", "badgeEditorTitle");
  modal.innerHTML = `<div class="dialoghead"><div><h2 id="badgeEditorTitle">แก้ไขดีไซน์เข็มกลัด</h2><p id="badgeEditorScope" class="hint"></p></div><button type="button" id="closeBadgeEditor" aria-label="ปิดตัวแก้ไข">×</button></div>
<div class="badge-editor-body"><section class="badge-preview-panel" aria-label="แคนวาสแก้ไขภาพ"><div class="badge-preview-toolbar"><button type="button" id="badgeUndo" aria-label="ย้อนกลับในตัวแก้ไข">ย้อนกลับ</button><button type="button" id="badgeRedo" aria-label="ทำซ้ำในตัวแก้ไข">ทำซ้ำ</button><button type="button" id="badgeCenter">จัดภาพกึ่งกลาง</button></div><div id="badgeStage" tabindex="0" aria-label="ลากภาพเพื่อปรับตำแหน่ง เลื่อนเมาส์เพื่อซูมภาพ"><div id="badgePreview"></div></div><p class="hint">ลากภาพเพื่อเลื่อนตำแหน่ง • เลื่อนเมาส์เพื่อย่อ–ขยาย • รองรับการวางไฟล์ภาพ</p></section>
<section class="badge-inspector"><div class="panel-tabs" role="tablist" aria-label="เครื่องมือดีไซน์"><button type="button" id="badgeImageTab" role="tab" aria-selected="true" aria-controls="badgeImagePanel">รูปภาพ</button><button type="button" id="badgeTextTab" role="tab" aria-selected="false" aria-controls="badgeTextPanel" tabindex="-1">ข้อความ</button><button type="button" id="badgeColorTab" role="tab" aria-selected="false" aria-controls="badgeColorPanel" tabindex="-1">สีและเส้น</button></div>
<div id="badgeImagePanel" role="tabpanel" aria-labelledby="badgeImageTab"><label class="badge-upload">เปลี่ยน / เพิ่มภาพ<input type="file" id="badgeImageFile" accept="image/png,image/jpeg,image/webp" /></label><p id="badgeImageInfo" class="hint"></p><div class="badge-adjustment"><label for="badgeScale">ขยายภาพ</label><input type="range" id="badgeScale" min="1" max="400" step="1" /><input type="number" id="badgeScaleNumber" min="1" max="2000" aria-label="ขยายภาพ เปอร์เซ็นต์" /><span>%</span></div><div class="badge-adjustment"><label for="badgeRotation">หมุนภาพ</label><input type="range" id="badgeRotation" min="-180" max="180" step=".1" /><input type="number" id="badgeRotationNumber" step=".1" aria-label="หมุนภาพ องศา" /><span>°</span></div><label>การวางภาพ<select id="badgeFit"><option value="cover">เต็มพื้นที่ / ครอบส่วนเกิน</option><option value="contain">เห็นภาพทั้งหมด</option></select></label><div class="badge-position-pair"><label>ตำแหน่ง X <output id="badgeXValue"></output><input type="range" id="badgeX" step=".1" /></label><label>ตำแหน่ง Y <output id="badgeYValue"></output><input type="range" id="badgeY" step=".1" class="vertical-range" aria-orientation="vertical" /></label></div></div>
<div id="badgeTextPanel" role="tabpanel" aria-labelledby="badgeTextTab" hidden><label>เลเยอร์ข้อความ<select id="badgeTextLayer"></select></label><div class="pair"><button id="badgeAddText" type="button">เพิ่มข้อความ</button><button id="badgeDeleteText" type="button">ลบข้อความ</button></div><label>ข้อความ<textarea id="badgeCaption" rows="4"></textarea></label><label><span id="badgeTextSizeLabel">ขนาดข้อความ (mm)</span><input type="number" id="badgeTextSize" min=".1" step=".1" /></label><label>สีข้อความ<input type="color" id="badgeTextColor" /></label><label>แนวนอน X<input type="range" id="badgeTextX" min="0" step=".1" /></label><label>แนวตั้ง Y<input type="range" id="badgeTextY" min="0" step=".1" /></label></div>
<div id="badgeColorPanel" role="tabpanel" aria-labelledby="badgeColorTab" hidden><label>สีพื้นชิ้นงาน<input type="color" id="badgeBackground" /></label><h3>เส้นช่วยออกแบบ</h3><label class="check"><input type="checkbox" id="badgeCutGuide" /> เส้นตัดรอบนอก</label><label class="check"><input type="checkbox" id="badgeFaceGuide" /> หน้าชิ้นงาน</label><label class="check"><input type="checkbox" id="badgeSafeGuide" /> พื้นที่ปลอดภัย</label><p class="hint">เส้นช่วยออกแบบใช้ค่าการแสดงผลของโปรเจกต์ การส่งออกยังเป็นไปตามตัวเลือกเดิม</p></div></section></div>
<div class="badge-editor-footer"><p id="badgeEditorStatus" role="status"></p><button id="resetBadgeDraft" type="button">เริ่มปรับใหม่</button><button id="cancelBadgeDraft" type="button">ยกเลิก</button><button id="saveBadgeDraft" type="button" class="primary">บันทึกและปิด</button></div>`;
  const rail = modal.querySelector('[role="tablist"]');
  rail.classList.add("badge-toolrail");
  const templateTab = document.createElement("button");
  templateTab.id = "badgeTemplateTab";
  templateTab.type = "button";
  templateTab.setAttribute("role", "tab");
  templateTab.setAttribute("aria-selected", "false");
  templateTab.setAttribute("aria-controls", "badgeTemplatePanel");
  templateTab.tabIndex = -1;
  templateTab.textContent = "เทมเพลต";
  rail.prepend(templateTab);
  const layerTab = document.createElement("button");
  layerTab.id = "badgeLayersTab";
  layerTab.type = "button";
  layerTab.setAttribute("role", "tab");
  layerTab.setAttribute("aria-selected", "false");
  layerTab.setAttribute("aria-controls", "badgeLayersPanel");
  layerTab.tabIndex = -1;
  layerTab.textContent = "เลเยอร์";
  rail.append(layerTab);
  modal.querySelector(".badge-editor-body").prepend(rail);
  modal
    .querySelector(".badge-inspector")
    .insertAdjacentHTML(
      "beforeend",
      '<div id="badgeTemplatePanel" role="tabpanel" aria-labelledby="badgeTemplateTab" hidden><p class="hint">เลือกดีไซน์ที่เคยบันทึกเพื่อใช้เป็นต้นแบบ การเปลี่ยนแปลงยังไม่บันทึกจนกดบันทึกและปิด</p><p id="badgeTemplateStatus" role="status"></p><div id="badgeDesignTemplates" class="designer-templates"></div></div><div id="badgeLayersPanel" role="tabpanel" aria-labelledby="badgeLayersTab" hidden><p class="hint">ข้อความด้านบนของรายการอยู่ด้านหน้าชิ้นงาน ปรับลำดับได้โดยไม่เปลี่ยนตำแหน่ง</p><div id="badgeLayerList"></div></div>',
    );
  const inspectorTitle = document.createElement("h3");
  inspectorTitle.id = "badgeInspectorTitle";
  modal.querySelector(".badge-inspector").prepend(inspectorTitle);
  for (const [id, name] of [
    ["badgeTemplateTab", "template"],
    ["badgeImageTab", "image"],
    ["badgeTextTab", "text"],
    ["badgeColorTab", "palette"],
    ["badgeLayersTab", "layers"],
  ]) {
    const button = modal.querySelector("#" + id);
    button.innerHTML = icon(name) + "<span>" + button.textContent + "</span>";
  }
  modal
    .querySelector(".badge-preview-toolbar")
    .insertAdjacentHTML(
      "beforeend",
      '<button type="button" id="badgeGrid" aria-pressed="false">' +
        icon("grid") +
        "<span>กริด</span></button>",
    );
  const nameField = document.createElement("label");
  nameField.id = "badgeNameField";
  nameField.className = "badge-name-field";
  nameField.hidden = true;
  nameField.innerHTML =
    'ชื่อดีไซน์<input id="badgeDesignName" maxlength="200" />';
  modal.querySelector(".dialoghead > div").append(nameField);
  for (const [id, label] of [
    ["badgeScale", "ขนาดภาพ"],
    ["badgeRotation", "มุมหมุน"],
    ["badgeX", "ตำแหน่ง X"],
    ["badgeY", "ตำแหน่ง Y"],
  ]) {
    const input = modal.querySelector("#" + id),
      caption =
        id === "badgeScale" || id === "badgeRotation"
          ? modal.querySelector('label[for="' + id + '"]')
          : input.closest("label");
    const button = document.createElement("button");
    button.id = id + "Reset";
    button.type = "button";
    button.className = "property-reset action-icon";
    button.title = "รีเซ็ต" + label;
    button.setAttribute("aria-label", button.title);
    button.innerHTML = icon("reset");
    caption.append(button);
  }
  modal
    .querySelector("#badgeTextPanel")
    .insertAdjacentHTML(
      "beforeend",
      '<label>แบบอักษร<select id="badgeFont"><option value="sans">อ่านง่าย</option><option value="serif">มีเชิง</option><option value="hand">ตัวอักษรมีหัว</option></select></label><label>น้ำหนัก<select id="badgeWeight"><option value="normal">ปกติ</option><option value="bold">หนา</option></select></label>',
    );
  document.body.append(modal);
  for (const key of [
    "badgeScaleNumber",
    "badgeRotationNumber",
    "badgeTextSize",
  ]) {
    $(key).required = true;
    $(key).step = "any";
  }
  let draft,
    original,
    assets,
    styles,
    history = [],
    future = [],
    layer = 0,
    drag = null,
    fileRevision = 0,
    lastWheel = 0,
    templateRevision = 0,
    editingContext = null;
  const snapshot = () => ({
    item: clone(draft),
    styles: clone(styles),
    name: $("badgeDesignName").value,
  });
  function remember() {
    history.push(snapshot());
    if (history.length > 30) history.shift();
    future = [];
  }
  function paint() {
    const source = getProject(),
      p = { ...source, assets, styles },
      size = draft.outer;
    const page = {
      paper: {
        width: size,
        height: size,
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      },
      items: [{ ...draft, x: 0, y: 0 }],
    };
    $("badgePreview").innerHTML = renderPage(p, page, { selectedIds: [] });
    const svg = $("badgePreview").querySelector("svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    $("badgeUndo").disabled = !history.length;
    $("badgeRedo").disabled = !future.length;
    renderLayers();
  }
  function sync() {
    const image = draft.image,
      unit = getProject().unit,
      factor = units[unit];
    $("badgeScale").max = String(Math.max(400, (image?.scale || 1) * 100));
    for (const key of ["badgeScale", "badgeScaleNumber"])
      $(key).value = String((image?.scale || 1) * 100);
    $("badgeRotation").min = String(Math.min(-180, image?.rotation || 0));
    $("badgeRotation").max = String(Math.max(180, image?.rotation || 0));
    for (const key of ["badgeRotation", "badgeRotationNumber"])
      $(key).value = String(image?.rotation || 0);
    $("badgeFit").value = image?.fit || "cover";
    for (const [axis, key] of [
      ["X", "dx"],
      ["Y", "dy"],
    ]) {
      $("badge" + axis).step = String(0.1 / factor);
      $("badge" + axis).min = -draft.outer / factor;
      $("badge" + axis).max = draft.outer / factor;
      $("badge" + axis).value = (image?.[key] || 0) / factor;
      $("badge" + axis + "Value").textContent =
        ((image?.[key] || 0) / factor).toFixed(unit === "inch" ? 4 : 2) +
        " " +
        unit;
    }
    for (const key of [
      "badgeScale",
      "badgeScaleNumber",
      "badgeRotation",
      "badgeRotationNumber",
      "badgeFit",
      "badgeX",
      "badgeY",
      "badgeCenter",
    ])
      $(key).disabled = !image;
    $("badgeBackground").value = draft.background;
    $("badgeImageInfo").textContent = image
      ? `${assets[image.asset].name} • ${assets[image.asset].width} × ${assets[image.asset].height} px`
      : "เลือกภาพเพื่อเริ่มปรับตำแหน่งและขนาด";
    $("badgeTextLayer").replaceChildren(
      ...draft.texts.map(
        (t, i) =>
          new Option(
            `${i + 1}. ${t.text.slice(0, 24) || "ข้อความว่าง"}`,
            String(i),
          ),
      ),
    );
    layer = Math.max(0, Math.min(layer, draft.texts.length - 1));
    $("badgeTextLayer").value = String(layer);
    const t = draft.texts[layer];
    for (const key of [
      "badgeCaption",
      "badgeTextSize",
      "badgeTextColor",
      "badgeTextX",
      "badgeTextY",
      "badgeDeleteText",
    ])
      $(key).disabled = !t;
    $("badgeCaption").value = t?.text || "";
    $("badgeTextSize").value = (t?.size || 5) / factor;
    $("badgeTextSize").min = 0.1 / factor;
    $("badgeTextSizeLabel").textContent = "ขนาดข้อความ (" + unit + ")";
    $("badgeTextColor").value = t?.color || "#172033";
    $("badgeFont").value = t?.font || "sans";
    $("badgeWeight").value = t?.weight || "normal";
    $("badgeFont").disabled = !t;
    $("badgeWeight").disabled = !t;
    for (const id of ["badgeScale", "badgeRotation", "badgeX", "badgeY"])
      $(id + "Reset").disabled = !image;
    for (const [axis, key] of [
      ["X", "x"],
      ["Y", "y"],
    ]) {
      $("badgeText" + axis).step = String(0.1 / factor);
      $("badgeText" + axis).max = draft.outer / factor;
      $("badgeText" + axis).value = (t?.[key] || 0) / factor;
    }
    for (const [input, key] of [
      ["badgeCutGuide", "cut"],
      ["badgeFaceGuide", "face"],
      ["badgeSafeGuide", "safe"],
    ])
      $(input).checked = styles[key].preview;
    paint();
  }
  function edit(fn, record = true) {
    if (record) remember();
    fn();
    paint();
  }
  const close = () => {
    fileRevision++;
    templateRevision++;
    drag = null;
    modal.close();
  };
  for (const id of ["closeBadgeEditor", "cancelBadgeDraft"])
    $(id).onclick = close;
  modal.addEventListener("cancel", () => {
    fileRevision++;
    drag = null;
  });
  for (const tab of modal.querySelectorAll("[role=tab]")) {
    tab.addEventListener("click", () => {
      for (const other of modal.querySelectorAll("[role=tab]")) {
        const active = other === tab;
        other.setAttribute("aria-selected", String(active));
        other.tabIndex = active ? 0 : -1;
        $(other.getAttribute("aria-controls")).hidden = !active;
      }
      $("badgeInspectorTitle").textContent = tab.textContent;
    });
    tab.addEventListener("keydown", (e) => {
      const tabs = [...modal.querySelectorAll("[role=tab]")];
      if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        const i =
          (tabs.indexOf(tab) + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) %
          tabs.length;
        tabs[i].click();
        tabs[i].focus();
      }
    });
  }
  $("badgeUndo").onclick = () => {
    if (!history.length) return;
    future.push(snapshot());
    const s = history.pop();
    draft = s.item;
    styles = s.styles;
    $("badgeDesignName").value = s.name;
    sync();
  };
  $("badgeRedo").onclick = () => {
    if (!future.length) return;
    history.push(snapshot());
    const s = future.pop();
    draft = s.item;
    styles = s.styles;
    $("badgeDesignName").value = s.name;
    sync();
  };
  $("resetBadgeDraft").onclick = () => {
    remember();
    draft = clone(original.item);
    styles = clone(original.styles);
    $("badgeDesignName").value = original.name;
    sync();
  };
  $("badgeGrid").onclick = () => {
    const active = $("badgeGrid").getAttribute("aria-pressed") !== "true";
    $("badgeGrid").setAttribute("aria-pressed", String(active));
    $("badgePreview").classList.toggle("alignment-grid", active);
  };
  for (const [control, key, fallback] of [
    ["badgeScale", "scale", 1],
    ["badgeRotation", "rotation", 0],
    ["badgeX", "dx", 0],
    ["badgeY", "dy", 0],
  ])
    $(control + "Reset").onclick = () => {
      if (!draft.image) return;
      edit(() => (draft.image[key] = original.item.image?.[key] ?? fallback));
      sync();
    };
  for (const [id, key] of [
    ["badgeFont", "font"],
    ["badgeWeight", "weight"],
  ])
    $(id).onchange = () => {
      if (draft.texts[layer])
        edit(() => (draft.texts[layer][key] = $(id).value));
    };
  function renderLayers() {
    const list = $("badgeLayerList");
    list.replaceChildren();
    function row(label, graphic, select, commands = []) {
      const el = document.createElement("div");
      el.className = "designer-layer";
      const choose = document.createElement("button");
      choose.type = "button";
      choose.className = "layer-select";
      choose.innerHTML = icon(graphic);
      const span = document.createElement("span");
      span.textContent = label;
      choose.append(span);
      choose.onclick = select;
      el.append(choose);
      for (const [name, title, fn] of commands) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "action-icon" + (name === "trash" ? " danger" : "");
        b.title = title;
        b.setAttribute("aria-label", title);
        b.innerHTML = icon(name);
        b.onclick = fn;
        el.append(b);
      }
      list.append(el);
    }
    for (let i = draft.texts.length - 1; i >= 0; i--) {
      const commands = [];
      if (i < draft.texts.length - 1)
        commands.push([
          "up",
          "เลื่อนข้อความขึ้น",
          () => {
            edit(() => {
              [draft.texts[i], draft.texts[i + 1]] = [
                draft.texts[i + 1],
                draft.texts[i],
              ];
            });
            layer = i + 1;
            sync();
          },
        ]);
      if (i > 0)
        commands.push([
          "down",
          "เลื่อนข้อความลง",
          () => {
            edit(() => {
              [draft.texts[i], draft.texts[i - 1]] = [
                draft.texts[i - 1],
                draft.texts[i],
              ];
            });
            layer = i - 1;
            sync();
          },
        ]);
      commands.push([
        "trash",
        "ลบเลเยอร์ข้อความ",
        () => {
          edit(() => draft.texts.splice(i, 1));
          sync();
        },
      ]);
      row(
        draft.texts[i].text || "ข้อความว่าง",
        "text",
        () => {
          layer = i;
          $("badgeTextTab").click();
          sync();
        },
        commands,
      );
    }
    if (draft.image)
      row("รูปภาพ", "image", () => $("badgeImageTab").click(), [
        [
          "trash",
          "ลบเฉพาะเลเยอร์ภาพ",
          () => {
            edit(() => (draft.image = null));
            sync();
          },
        ],
      ]);
    row("พื้นหลัง", "palette", () => $("badgeColorTab").click());
  }
  async function loadTemplates() {
    const revision = ++templateRevision;
    $("badgeTemplateStatus").textContent = "กำลังโหลดเทมเพลต…";
    try {
      const options = await getTemplates();
      if (!modal.open || revision !== templateRevision) return;
      $("badgeDesignTemplates").replaceChildren();
      $("badgeTemplateStatus").textContent = options.length
        ? ""
        : "ยังไม่มีดีไซน์ที่บันทึกไว้";
      options.forEach((option, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "designer-template";
        const preview = document.createElement("span");
        preview.className = "designer-template-preview";
        preview.inert = true;
        preview.setAttribute("aria-hidden", "true");
        preview.innerHTML = renderPage(
          { ...getProject(), assets: option.assets },
          {
            paper: {
              width: option.item.outer,
              height: option.item.outer,
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
            },
            items: [{ ...option.item, x: 0, y: 0 }],
          },
          { selectedIds: [], prefix: "designer-template-" + index + "-" },
        );
        const label = document.createElement("span");
        label.textContent = option.name;
        button.append(preview, label);
        button.onclick = () => {
          remember();
          Object.assign(assets, clone(option.assets));
          const source = option.item;
          draft.background = source.background;
          draft.image = clone(source.image);
          draft.texts = source.texts.map((t) => ({
            ...clone(t),
            x: (t.x * draft.outer) / source.outer,
            y: (t.y * draft.outer) / source.outer,
          }));
          if (draft.image) {
            draft.image.dx *= draft.outer / source.outer;
            draft.image.dy *= draft.outer / source.outer;
          }
          sync();
          $("badgeEditorStatus").textContent =
            "ใช้ต้นแบบแล้ว • กดบันทึกและปิดเพื่อนำไปใช้";
        };
        $("badgeDesignTemplates").append(button);
      });
    } catch (e) {
      if (revision === templateRevision)
        $("badgeTemplateStatus").textContent =
          "โหลดเทมเพลตไม่สำเร็จ: " + e.message;
    }
  }
  $("badgeCenter").onclick = () => {
    edit(() => {
      draft.image.dx = 0;
      draft.image.dy = 0;
    });
    sync();
  };
  for (const [prefix, key, factor] of [
    ["badgeScale", "scale", 0.01],
    ["badgeRotation", "rotation", 1],
  ])
    for (const suffix of ["", "Number"])
      $(prefix + suffix).addEventListener("input", () => {
        if (!draft.image) return;
        const n = Number($(prefix + suffix).value);
        if (!Number.isFinite(n) || $(prefix + suffix).value === "") return;
        edit(
          () =>
            (draft.image[key] =
              key === "scale" ? Math.min(20, Math.max(0.01, n * factor)) : n),
        );
        if (key === "scale")
          $("badgeScale").max = String(Math.max(400, draft.image.scale * 100));
        else {
          $("badgeRotation").min = String(Math.min(-180, n));
          $("badgeRotation").max = String(Math.max(180, n));
        }
        $(prefix + (suffix ? "" : "Number")).value =
          key === "scale" ? draft.image.scale * 100 : n;
      });
  $("badgeFit").onchange = () => {
    if (draft.image) edit(() => (draft.image.fit = $("badgeFit").value));
  };
  for (const [axis, key] of [
    ["X", "dx"],
    ["Y", "dy"],
  ])
    $("badge" + axis).addEventListener("input", () => {
      if (draft.image)
        edit(
          () =>
            (draft.image[key] =
              Number($("badge" + axis).value) * units[getProject().unit]),
        );
      $("badge" + axis + "Value").textContent =
        Number($("badge" + axis).value).toFixed(
          getProject().unit === "inch" ? 4 : 2,
        ) +
        " " +
        getProject().unit;
    });
  $("badgeBackground").oninput = () =>
    edit(() => (draft.background = $("badgeBackground").value));
  for (const [input, key] of [
    ["badgeCutGuide", "cut"],
    ["badgeFaceGuide", "face"],
    ["badgeSafeGuide", "safe"],
  ])
    $(input).onchange = () =>
      edit(() => (styles[key].preview = $(input).checked));
  $("badgeTextLayer").onchange = () => {
    layer = Number($("badgeTextLayer").value);
    sync();
  };
  $("badgeAddText").onclick = () => {
    edit(() => draft.texts.push(defaultText(draft)));
    layer = draft.texts.length - 1;
    sync();
  };
  $("badgeDeleteText").onclick = () => {
    edit(() => draft.texts.splice(layer, 1));
    sync();
  };
  for (const [input, key] of [
    ["badgeCaption", "text"],
    ["badgeTextSize", "size"],
    ["badgeTextColor", "color"],
    ["badgeTextX", "x"],
    ["badgeTextY", "y"],
  ])
    $(input).oninput = () => {
      const value = ["size", "x", "y"].includes(key)
        ? Number($(input).value) * units[getProject().unit]
        : $(input).value;
      if (key === "size" && (!Number.isFinite(value) || value <= 0)) return;
      edit(() => (draft.texts[layer][key] = value));
    };
  const stage = $("badgeStage");
  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !draft.image) return;
    e.preventDefault();
    remember();
    drag = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      dx: draft.image.dx,
      dy: draft.image.dy,
      ratio: draft.outer / $("badgePreview").getBoundingClientRect().width,
    };
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener("pointermove", (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    draft.image.dx = Math.max(
      -draft.outer,
      Math.min(draft.outer, drag.dx + (e.clientX - drag.x) * drag.ratio),
    );
    draft.image.dy = Math.max(
      -draft.outer,
      Math.min(draft.outer, drag.dy + (e.clientY - drag.y) * drag.ratio),
    );
    sync();
  });
  const end = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    drag = null;
    if (stage.hasPointerCapture(e.pointerId))
      stage.releasePointerCapture(e.pointerId);
  };
  stage.addEventListener("pointerup", end);
  stage.addEventListener("pointercancel", (e) => {
    if (drag) {
      const previous = history.pop();
      draft = previous.item;
      styles = previous.styles;
      sync();
    }
    end(e);
  });
  stage.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (!draft.image) return;
      const time = Date.now();
      if (time - lastWheel > 200) remember();
      lastWheel = time;
      draft.image.scale = Math.max(
        0.01,
        Math.min(
          20,
          draft.image.scale *
            Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.025 : 0.002)),
        ),
      );
      sync();
    },
    { passive: false },
  );
  stage.addEventListener("keydown", (e) => {
    if (
      !draft.image ||
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
    )
      return;
    e.preventDefault();
    edit(() => {
      const axis = ["ArrowLeft", "ArrowRight"].includes(e.key) ? "dx" : "dy";
      draft.image[axis] = Math.max(
        -draft.outer,
        Math.min(
          draft.outer,
          draft.image[axis] +
            (["ArrowLeft", "ArrowUp"].includes(e.key) ? -1 : 1) *
              (e.shiftKey ? 1 : 0.1),
        ),
      );
    });
    sync();
  });
  async function loadImage(file) {
    if (!file) return;
    const revision = ++fileRevision;
    $("saveBadgeDraft").disabled = true;
    $("badgeEditorStatus").textContent = "กำลังโหลดภาพ…";
    try {
      if (
        !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
        file.size > 25 * 1024 * 1024
      )
        throw Error("ใช้ PNG, JPEG หรือ WebP ขนาดไม่เกิน 25 MB");
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(Error("อ่านไฟล์ไม่สำเร็จ"));
        reader.readAsDataURL(file);
      });
      const image = new Image();
      image.src = data;
      await image.decode();
      if (!modal.open || revision !== fileRevision) return;
      if (image.naturalWidth > 50000 || image.naturalHeight > 50000)
        throw Error("ภาพต้องไม่เกิน 50,000 พิกเซล");
      remember();
      const key = id();
      assets[key] = {
        name: file.name,
        data,
        width: image.naturalWidth,
        height: image.naturalHeight,
      };
      draft.image = {
        asset: key,
        fit: "cover",
        scale: 1,
        dx: 0,
        dy: 0,
        rotation: 0,
      };
      $("badgeEditorStatus").textContent = "";
      sync();
    } catch (e) {
      $("badgeEditorStatus").textContent = e.message;
    } finally {
      if (revision === fileRevision) $("saveBadgeDraft").disabled = false;
    }
  }
  $("badgeImageFile").onchange = async () => {
    await loadImage($("badgeImageFile").files[0]);
    $("badgeImageFile").value = "";
  };
  stage.ondragover = (e) => e.preventDefault();
  stage.ondrop = (e) => {
    e.preventDefault();
    loadImage(e.dataTransfer.files[0]);
  };
  $("saveBadgeDraft").onclick = async () => {
    const invalid = [...modal.querySelectorAll('input[type="number"]')].find(
      (input) => !input.disabled && !input.checkValidity(),
    );
    if (invalid) {
      $("badgeEditorStatus").textContent =
        "กรุณาระบุค่าตัวเลขให้ครบและอยู่ในช่วงที่กำหนด";
      invalid.reportValidity();
      return;
    }
    if (
      editingContext?.kind === "design" &&
      !$("badgeDesignName").value.trim()
    ) {
      $("badgeEditorStatus").textContent = "กรุณาระบุชื่อดีไซน์";
      $("badgeDesignName").focus();
      return;
    }
    $("saveBadgeDraft").disabled = true;
    try {
      await onSave(
        clone(draft),
        assets,
        clone(styles),
        editingContext?.kind === "design"
          ? { name: $("badgeDesignName").value.trim() }
          : null,
      );
      close();
    } catch (e) {
      $("badgeEditorStatus").textContent = e.message;
    } finally {
      $("saveBadgeDraft").disabled = false;
    }
  };
  return {
    open() {
      const item = getItem();
      if (!item) return;
      draft = clone(item);
      $("badgeEditorTitle").textContent =
        "แก้ไขดีไซน์" +
        (item.type === "round"
          ? "เข็มกลัด"
          : item.type === "square"
            ? "แม่เหล็ก"
            : "สติกเกอร์");
      assets = clone(getProject().assets);
      styles = clone(getProject().styles);
      editingContext = getEditingContext();
      $("badgeNameField").hidden = editingContext?.kind !== "design";
      $("badgeDesignName").value = editingContext?.name || getProject().name;
      original = snapshot();
      history = [];
      future = [];
      layer = 0;
      lastWheel = 0;
      $("badgeEditorStatus").textContent = "";
      $("saveBadgeDraft").disabled = false;
      $("badgeEditorScope").textContent =
        `ปรับภาพ ข้อความ และสี • บันทึกให้ ${getSelectionCount()} ชิ้นที่เลือก`;
      modal.showModal();
      $("badgeGrid").setAttribute("aria-pressed", "false");
      $("badgePreview").classList.remove("alignment-grid");
      $("badgeImageTab").click();
      sync();
      loadTemplates();
    },
  };
}
