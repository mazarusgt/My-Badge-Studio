const $ = (id) => document.getElementById(id);
const icon = (path) =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
const icons = {
  art: "M3 3h18v18H3z M3 17l6-6 5 5 3-3 4 4",
  text: "M4 4h16 M12 4v16 M8 20h8",
  size: "M4 4h16v16H4z M8 4v4 M12 4v4 M16 4v4",
  paper: "M5 2h10l5 5v15H5z M15 2v6h5",
  guides: "M4 4h16v16H4z M8 2v20 M2 8h20",
  position: "M12 2v20 M2 12h20 m-13-8 3-3 3 3 M4 9l-3 3 3 3",
  select: "M3 8V3h5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5",
};
function createTabs(parent, name, groups) {
  const nav = document.createElement("div");
  nav.className = "panel-tabs";
  nav.setAttribute("role", "tablist");
  nav.setAttribute("aria-label", name);
  parent.append(nav);
  groups.forEach((group, i) => {
    const panel = document.createElement("section");
    panel.id = group.id;
    panel.className = "tab-panel";
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", group.id + "Tab");
    panel.hidden = i !== 0;
    const button = document.createElement("button");
    button.type = "button";
    button.id = group.id + "Tab";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", group.id);
    button.setAttribute("aria-selected", String(i === 0));
    button.tabIndex = i === 0 ? 0 : -1;
    button.innerHTML =
      icon(icons[group.icon] || icons.size) + `<span>${group.label}</span>`;
    button.addEventListener("click", () => {
      for (const tab of nav.children) {
        const active = tab === button;
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
        $(tab.getAttribute("aria-controls")).hidden = !active;
      }
      parent.dispatchEvent(new CustomEvent("panelchange", { bubbles: true }));
    });
    button.addEventListener("keydown", (e) => {
      const tabs = [...nav.children];
      let next;
      if (e.key === "ArrowRight")
        next = (tabs.indexOf(button) + 1) % tabs.length;
      if (e.key === "ArrowLeft")
        next = (tabs.indexOf(button) - 1 + tabs.length) % tabs.length;
      if (e.key === "Home") next = 0;
      if (e.key === "End") next = tabs.length - 1;
      if (next !== undefined) {
        e.preventDefault();
        tabs[next].click();
        tabs[next].focus();
      }
    });
    nav.append(button);
    group.nodes.forEach((node) => panel.append(node));
    parent.append(panel);
  });
}
export function revealControl(id) {
  const node = $(id);
  if (!node) return;
  const panel = node.closest('[role="tabpanel"]');
  if (panel) $(`${panel.id}Tab`)?.click();
  for (
    let details = node.closest("details");
    details;
    details = details.parentElement.closest("details")
  )
    details.open = true;
  const aside = node.closest("aside");
  if (aside?.classList.contains("panel-collapsed"))
    aside.querySelector(".panel-toggle")?.click();
}
function segmented(select, labels) {
  const group = document.createElement("div");
  group.className = "segmented";
  group.dataset.for = select.id;
  group.setAttribute("role", "group");
  group.setAttribute(
    "aria-label",
    select.closest("label")?.firstChild.textContent.trim() || "ตัวเลือก",
  );
  for (const option of select.options) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.value = option.value;
    b.setAttribute("aria-pressed", "false");
    b.innerHTML = labels?.[option.value] || option.textContent;
    b.addEventListener("click", () => {
      if (select.disabled) return;
      select.value = option.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      syncEditorControls();
    });
    group.append(b);
  }
  select.after(group);
  select.classList.add("replaced-control");
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");
}
function stepper(input) {
  const wrapper = document.createElement("div");
  wrapper.className = "number-stepper";
  input.before(wrapper);
  const name =
    input.closest("label")?.textContent.trim().split("\n")[0] || "ค่า";
  for (const direction of [-1, 1]) {
    const b = document.createElement("button");
    b.type = "button";
    b.innerHTML = icon(direction < 0 ? "M5 12h14" : "M5 12h14 M12 5v14");
    b.setAttribute("aria-label", (direction < 0 ? "ลด " : "เพิ่ม ") + name);
    b.addEventListener("click", () => {
      if (input.disabled) return;
      const step = input.step === "any" || !input.step ? 1 : Number(input.step);
      let value = Number(input.value || 0) + direction * step;
      if (input.min !== "") value = Math.max(Number(input.min), value);
      if (input.max !== "") value = Math.min(Number(input.max), value);
      input.value = String(Number(value.toFixed(8)));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    wrapper.append(b);
    if (direction < 0) wrapper.append(input);
  }
}
function saveLayoutPreferences(state) {
  try {
    localStorage.setItem("badge-editor-panels", JSON.stringify(state));
  } catch {
    /* Private browsing can restrict preferences; editing still works. */
  }
}
function initResizers() {
  let saved = {};
  try {
    saved =
      JSON.parse(localStorage.getItem("badge-editor-panels") || "{}") || {};
  } catch {}
  const root = document.documentElement,
    main = document.querySelector("main");
  const state = { left: 280, right: 300, top: 200, ...saved };
  for (const side of ["left", "right", "top"]) {
    const horizontal = side !== "top",
      panel =
        side === "left"
          ? $("itemSettings")
          : side === "right"
            ? $("designSettings")
            : $("topTools");
    const min = horizontal ? 230 : 110,
      max = horizontal ? Math.min(460, innerWidth * 0.32) : 340;
    let expanded = Math.min(max, Math.max(min, Number(state[side]) || min));
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "panel-toggle";
    toggle.setAttribute(
      "aria-label",
      `ย่อ/ขยายแผง${side === "left" ? "ซ้าย" : side === "right" ? "ขวา" : "บน"}`,
    );
    toggle.title = toggle.getAttribute("aria-label");
    toggle.innerHTML = icon(horizontal ? "m14 6-6 6 6 6" : "m6 14 6-6 6 6");
    panel.prepend(toggle);
    const handle = document.createElement("div");
    handle.className = `panel-resizer resize-${side}`;
    handle.tabIndex = 0;
    handle.setAttribute("role", "separator");
    handle.setAttribute(
      "aria-label",
      `ปรับขนาดแผง${side === "left" ? "ซ้าย" : side === "right" ? "ขวา" : "บน"}`,
    );
    handle.setAttribute(
      "aria-orientation",
      horizontal ? "vertical" : "horizontal",
    );
    handle.setAttribute("aria-valuemin", horizontal ? "52" : "46");
    handle.setAttribute("aria-valuemax", String(Math.round(max)));
    if (horizontal) main.append(handle);
    else panel.append(handle);
    function apply(value) {
      const collapsed = value < (horizontal ? 90 : 80);
      const size = collapsed
        ? horizontal
          ? 52
          : 46
        : Math.min(max, Math.max(min, value));
      panel.classList.toggle("panel-collapsed", collapsed);
      root.style.setProperty(`--${side}-size`, size + "px");
      handle.setAttribute("aria-valuenow", String(Math.round(size)));
      toggle.setAttribute("aria-expanded", String(!collapsed));
      if (!collapsed) expanded = size;
      state[side] = size;
    }
    apply(Number(state[side]) || expanded);
    toggle.addEventListener("click", () => {
      apply(panel.classList.contains("panel-collapsed") ? expanded : 0);
      saveLayoutPreferences(state);
    });
    let drag;
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      drag = { start: horizontal ? e.clientX : e.clientY, size: state[side] };
      handle.setPointerCapture(e.pointerId);
      document.body.classList.add("resizing-panels");
    });
    handle.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const delta = (horizontal ? e.clientX : e.clientY) - drag.start;
      apply(drag.size + delta * (side === "right" ? -1 : 1));
    });
    const stop = () => {
      if (!drag) return;
      drag = null;
      document.body.classList.remove("resizing-panels");
      saveLayoutPreferences(state);
    };
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
    handle.addEventListener("lostpointercapture", stop);
    handle.addEventListener("keydown", (e) => {
      if (
        [
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
          "Home",
          "End",
        ].includes(e.key)
      ) {
        e.preventDefault();
        const negative = ["ArrowLeft", "ArrowUp"].includes(e.key);
        apply(
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? max
              : state[side] +
                (negative ? -20 : 20) * (side === "right" ? -1 : 1),
        );
        saveLayoutPreferences(state);
      }
    });
  }
}
export function syncEditorControls() {
  for (const group of document.querySelectorAll(".segmented")) {
    const select = $(group.dataset.for);
    for (const b of group.children) {
      b.setAttribute("aria-pressed", String(b.dataset.value === select.value));
      b.disabled = select.disabled;
    }
  }
  for (const step of document.querySelectorAll(".number-stepper"))
    for (const b of step.querySelectorAll("button"))
      b.disabled = step.querySelector("input").disabled;
  for (const b of document.querySelectorAll("[data-preset]"))
    b.setAttribute(
      "aria-pressed",
      String(b.dataset.preset === $("preset").value),
    );
}
export function initEditorControls() {
  const left = $("itemSettings"),
    right = $("designSettings");
  const paper = $("paperSettings"),
    guides = left.querySelector("details:not(#paperSettings)");
  const leftNodes = [...left.children].filter(
    (n) => n !== paper && n !== guides,
  );
  createTabs(left, "ตั้งค่าชิ้นงาน", [
    { id: "sizePanel", label: "ชิ้นงาน", icon: "size", nodes: leftNodes },
    { id: "paperPanel", label: "กระดาษ", icon: "paper", nodes: [paper] },
    { id: "guidesPanel", label: "เส้น", icon: "guides", nodes: [guides] },
  ]);
  paper.open = true;
  guides.open = true;
  const texts = $("caption").closest("details"),
    position = $("itemX").closest("details");
  const footer = document.createElement("div");
  footer.className = "panel-actions";
  for (const id of ["openBadgeEditor", "applyAll", "bulk", "saveTemplate"])
    footer.append($(id));
  const rightNodes = [...right.children].filter(
    (n) => n !== texts && n !== position && n.id !== "designSelection",
  );
  const summary = $("designSelection");
  right.prepend(summary);
  createTabs(right, "ออกแบบชิ้นงาน", [
    { id: "artPanel", label: "รูปภาพ", icon: "art", nodes: rightNodes },
    { id: "textPanel", label: "ข้อความ", icon: "text", nodes: [texts] },
    {
      id: "positionPanel",
      label: "ตำแหน่ง",
      icon: "position",
      nodes: [position],
    },
  ]);
  position.open = true;
  texts.open = true;
  right.append(footer);
  const top = document.createElement("div");
  top.id = "topTools";
  top.className = "top-tools";
  const workspace = document.querySelector(".workspace"),
    toolbar = workspace.querySelector(".toolbar"),
    selection = workspace.querySelector(".selection-tools");
  workspace.prepend(top);
  createTabs(top, "เครื่องมือแคนวาส", [
    {
      id: "pageTools",
      label: "หน้าและจัดเรียง",
      icon: "paper",
      nodes: [toolbar],
    },
    {
      id: "selectionTools",
      label: "ชิ้นที่เลือก",
      icon: "select",
      nodes: [selection],
    },
  ]);
  segmented($("type"), {
    round: icon("M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18") + "เข็มกลัด",
    square: icon(icons.size) + "แม่เหล็ก",
    sticker: icon("M4 3h16v11l-6 7H4z M14 21v-7h6") + "สติกเกอร์",
  });
  segmented($("imageFit"));
  segmented($("weight"));
  segmented($("font"));
  const presets = document.createElement("div");
  presets.id = "presetButtons";
  presets.className = "preset-buttons";
  $("preset").after(presets);
  for (const input of document.querySelectorAll('input[type="number"]'))
    stepper(input);
  const design = $("designGallery"),
    layout = $("layoutGallery");
  const custom = $("customTemplates"),
    customHeading = custom.previousElementSibling.previousElementSibling,
    customHint = custom.previousElementSibling;
  design.append(customHeading, customHint, custom);
  createTabs($("libraryGalleries"), "ประเภทเทมเพลต", [
    {
      id: "designGallery",
      label: "แกลเลอรีดีไซน์",
      icon: "art",
      nodes: [...design.children],
    },
    {
      id: "layoutGallery",
      label: "แกลเลอรีเลย์เอาต์",
      icon: "paper",
      nodes: [...layout.children],
    },
  ]);
  design.remove();
  layout.remove();
  $("preset").classList.add("replaced-control");
  $("preset").tabIndex = -1;
  $("preset").setAttribute("aria-hidden", "true");
  initResizers();
  for (const link of document.querySelectorAll(".workspace-nav a"))
    link.addEventListener("click", () => {
      const target = link.getAttribute("href").slice(1);
      revealControl(
        target === "itemSettings"
          ? "type"
          : target === "designSettings"
            ? "image"
            : "paper",
      );
    });
  document.addEventListener("focusin", () => syncEditorControls());
}
export function updatePresetButtons() {
  const container = $("presetButtons");
  if (!container) return;
  const signature = [...$("preset").options].map((o) => o.value).join(",");
  if (container.dataset.signature !== signature) {
    container.dataset.signature = signature;
    container.replaceChildren();
    for (const o of $("preset").options) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.preset = o.value;
      b.textContent = o.value === "custom" ? "กำหนดเอง" : o.textContent;
      b.addEventListener("click", () => {
        $("preset").value = o.value;
        $("preset").dispatchEvent(new Event("change", { bubbles: true }));
      });
      container.append(b);
    }
  }
  syncEditorControls();
}
