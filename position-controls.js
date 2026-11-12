import { icon } from "./ui-icons.js";
const $ = (id) => document.getElementById(id);
const positions = {
  itemX: ["x", "item"],
  itemY: ["y", "item"],
  imageX: ["x", "image"],
  imageY: ["y", "image"],
  textX: ["x", "text"],
  textY: ["y", "text"],
};
export function createPositionControls({
  getPage,
  getItem,
  getUnit,
  preview,
  restore,
}) {
  const ranges = new Map();
  for (const [id, [axis]] of Object.entries(positions)) {
    const input = $(id),
      old = input.closest(".number-stepper");
    if (old) {
      old.before(input);
      old.remove();
    }
    const group = document.createElement("div");
    group.className = "position-control axis-" + axis;
    input.before(group);
    const range = document.createElement("input");
    range.type = "range";
    range.id = id + "Slider";
    range.step = "any";
    range.setAttribute(
      "aria-label",
      input.closest("label")?.firstChild.textContent.trim() || id,
    );
    if (axis === "y") range.setAttribute("aria-orientation", "vertical");
    group.append(range, input);
    ranges.set(id, range);
    range.addEventListener("input", () => {
      input.value = range.value;
      preview(id, Number(range.value));
    });
    range.addEventListener("change", () => {
      input.value = range.value;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    range.addEventListener("pointercancel", () => restore());
  }
  function sync() {
    const page = getPage(),
      item = getItem();
    for (const [id, range] of ranges) {
      const [axis, kind] = positions[id],
        unit = getUnit(id),
        outer = item?.outer || 68;
      const max =
        kind === "item"
          ? Math.max(0, page.paper[axis === "x" ? "width" : "height"] - outer)
          : outer;
      range.min = String((kind === "image" ? -outer : 0) / unit);
      range.max = String(max / unit);
      range.value = $(id).value;
      range.disabled = $(id).disabled || !item;
      range.setAttribute(
        "aria-valuetext",
        `${Number(Number($(id).value).toFixed(3))} ${$(id + "Unit").value}`,
      );
    }
  }
  return { sync };
}
export function configurePageControls({ setUnit, onOrientation, onCenter }) {
  const settings = $("paperSettings");
  const unitLabel = document.createElement("label");
  unitLabel.className = "page-unit";
  unitLabel.textContent = "หน่วยสำหรับตั้งค่ากระดาษ";
  const unit = document.createElement("select");
  unit.id = "pageUnit";
  unit.innerHTML =
    '<option value="mm">มิลลิเมตร (mm)</option><option value="cm">เซนติเมตร (cm)</option><option value="inch">นิ้ว (inch)</option>';
  unitLabel.append(unit);
  settings.querySelector("summary").after(unitLabel);
  unit.addEventListener("change", () => setUnit(unit.value));
  for (const select of [unit, $("unit")]) {
    const picker = document.createElement("div");
    picker.className = "unit-picker";
    picker.dataset.unitFor = select.id;
    picker.setAttribute("role", "group");
    picker.setAttribute("aria-label", "หน่วยวัดทั้งหมด");
    for (const [value, label] of [
      ["mm", "mm"],
      ["cm", "cm"],
      ["inch", "in"],
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.unit = value;
      button.textContent = label;
      button.addEventListener("click", () => {
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      picker.append(button);
    }
    select.after(picker);
    select.classList.add("replaced-control");
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");
  }
  const ids = [
    "width",
    "height",
    "top",
    "bottom",
    "left",
    "right",
    "gapX",
    "gapY",
  ];
  for (const id of ids) {
    $(id + "Unit").classList.add("page-dimension-unit");
    $(id + "Unit").tabIndex = -1;
    $(id + "Unit").setAttribute("aria-hidden", "true");
  }
  const grid = document.createElement("fieldset");
  grid.className = "page-grid";
  grid.innerHTML =
    '<legend>แถว คอลัมน์ และระยะห่าง</legend><p class="hint">ใส่ 0 เพื่อคำนวณจำนวนอัตโนมัติ แล้วกดจัดเต็มหน้า</p><div class="pair"></div>';
  for (const [id, name, graphic] of [
    ["cols", "คอลัมน์", "columns"],
    ["rows", "แถว", "rows"],
    ["gapX", "ระยะห่างคอลัมน์", "gapX"],
    ["gapY", "ระยะห่างแถว", "gapY"],
  ]) {
    const label = $(id).closest("label");
    label.firstChild.textContent = "";
    const caption = document.createElement("span");
    caption.className = "property-caption";
    caption.innerHTML = icon(graphic) + name;
    label.prepend(caption);
    grid.querySelector(".pair").append(label);
  }
  const margins = document.createElement("fieldset");
  margins.className = "page-margins";
  margins.innerHTML =
    '<legend>เว้นขอบกระดาษ</legend><div class="pair"></div><button type="button" id="centerLayout">จัดชิ้นงานให้อยู่กลางหน้า</button>';
  for (const id of ["top", "bottom", "left", "right"])
    margins.querySelector(".pair").append($(id).closest("label"));
  $("rotate").after(grid, margins);
  $("centerLayout").addEventListener("click", onCenter);
  const orientation = document.createElement("div");
  orientation.className = "orientation-options";
  orientation.setAttribute("role", "group");
  orientation.setAttribute("aria-label", "แนวกระดาษ");
  orientation.innerHTML =
    '<button type="button" data-orientation="portrait">แนวตั้ง</button><button type="button" data-orientation="landscape">แนวนอน</button>';
  $("rotate").before(orientation);
  for (const button of orientation.children)
    button.addEventListener("click", () =>
      onOrientation(button.dataset.orientation),
    );
  $("rotate").classList.add("secondary-orientation");
  // Retain exact numeric fields; only the page-specific unit dropdowns are unified.
  return {
    sync(page, currentUnit) {
      unit.value = currentUnit;
      for (const group of document.querySelectorAll("[data-unit-for]"))
        for (const button of group.children)
          button.setAttribute(
            "aria-pressed",
            String(button.dataset.unit === currentUnit),
          );
      for (const button of orientation.children)
        button.setAttribute(
          "aria-pressed",
          String(
            button.dataset.orientation ===
              (page.paper.width <= page.paper.height
                ? "portrait"
                : "landscape"),
          ),
        );
    },
  };
}
