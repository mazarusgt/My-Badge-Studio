import { clone, packItems } from "./model.js";
export function createLiveLayout({
  getPage,
  readGap,
  preview,
  commit,
  notify,
}) {
  const ids = ["cols", "rows", "gapX", "gapY"];
  const fields = ids.map((id) => document.getElementById(id));
  const feedback = document.createElement("p");
  feedback.id = "layoutFeedback";
  feedback.className = "layout-feedback";
  feedback.setAttribute("role", "status");
  feedback.setAttribute("aria-live", "polite");
  document.querySelector(".page-grid").append(feedback);
  let axis = null,
    frame = null;
  function build() {
    const page = clone(getPage());
    for (const id of ["cols", "rows"]) {
      const raw = document.getElementById(id).value;
      if (
        !raw.trim() ||
        !Number.isInteger(Number(raw)) ||
        Number(raw) < 0 ||
        Number(raw) > 1000
      )
        throw Error("แถวและคอลัมน์ต้องเป็นจำนวนเต็ม 0–1,000 (0 = อัตโนมัติ)");
      page.layout[id] = Number(raw);
    }
    for (const id of ["gapX", "gapY"]) {
      const value = readGap(id);
      if (value < 0 || value > 2000)
        throw Error("ระยะห่างต้องไม่ติดลบและไม่เกิน 2,000 mm");
      page.layout[id] = value;
    }
    if (axis?.page === page.id && page.layout[axis.key] > 0)
      page.layout.axis = axis.key;
    packItems(page);
    return page;
  }
  function showError(error) {
    preview(getPage());
    feedback.textContent =
      error.message +
      " • คงชิ้นงานและตำแหน่งเดิมไว้ กรุณาลดค่า หรือใช้ 0 เพื่อคำนวณอัตโนมัติ";
    feedback.classList.add("invalid");
    for (const field of fields) field.setAttribute("aria-invalid", "true");
  }
  function valid(page) {
    feedback.classList.remove("invalid");
    for (const field of fields) field.removeAttribute("aria-invalid");
    feedback.textContent = page.items.length
      ? `จัดวาง ${page.items.length} ชิ้น • คงจำนวน ขนาด และดีไซน์เดิม`
      : "ยังไม่มีชิ้นงาน • เพิ่มชิ้นงานเพื่อเริ่มจัดวาง";
  }
  function run(save) {
    if (frame) {
      cancelAnimationFrame(frame);
      frame = null;
    }
    try {
      const page = build();
      if (save) {
        const current = getPage();
        const unchanged =
          JSON.stringify(current.layout) === JSON.stringify(page.layout) &&
          current.items.every(
            (a, i) =>
              a.id === page.items[i]?.id &&
              a.x === page.items[i].x &&
              a.y === page.items[i].y,
          );
        if (!unchanged && !commit(page)) return;
      } else preview(page);
      valid(page);
      return true;
    } catch (error) {
      showError(error);
      return false;
    }
  }
  for (const field of fields) {
    field.addEventListener("input", () => {
      if (field.id === "rows" || field.id === "cols")
        axis = { page: getPage().id, key: field.id };
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        run(false);
      });
    });
    field.addEventListener("change", () => {
      if (field.id === "rows" || field.id === "cols")
        axis = { page: getPage().id, key: field.id };
      run(true);
    });
  }
  return {
    arrange: () => {
      if (run(true)) notify();
    },
    sync() {
      if (frame) cancelAnimationFrame(frame);
      frame = null;
      axis = null;
      valid(getPage());
    },
  };
}
