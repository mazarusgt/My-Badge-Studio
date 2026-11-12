import { icon } from "./ui-icons.js";
export function createCanvasActions({
  getAnchor,
  getSheetRect,
  getCanvasRect,
  onEdit,
  onDuplicate,
  onDelete,
}) {
  const toolbar = document.createElement("div");
  toolbar.id = "canvasItemActions";
  toolbar.className = "canvas-item-actions";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "การทำงานกับชิ้นที่เลือก");
  toolbar.hidden = true;
  for (const [id, name, label, fn] of [
    ["canvasEditItem", "edit", "แก้ไขดีไซน์", onEdit],
    ["canvasDuplicateItem", "copy", "ทำสำเนาชิ้นที่เลือก", onDuplicate],
    ["canvasDeleteItem", "trash", "ลบชิ้นที่เลือก", onDelete],
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.id = id;
    button.className = "action-icon" + (name === "trash" ? " danger" : "");
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = icon(name);
    button.addEventListener("click", () => {
      hide();
      fn();
    });
    toolbar.append(button);
  }
  document.body.append(toolbar);
  function sync() {
    if (toolbar.hidden) return;
    const rect = getAnchor();
    if (!rect || rect.bottom < 0 || rect.top > innerHeight) {
      hide();
      return;
    }
    const width = toolbar.offsetWidth,
      height = toolbar.offsetHeight,
      canvas = getCanvasRect(),
      sheet = getSheetRect();
    let left = rect.left + rect.width / 2 - width / 2,
      top = rect.top - height - 8;
    if (canvas.right - sheet.right >= width + 12) left = sheet.right + 8;
    else if (sheet.left - canvas.left >= width + 12)
      left = sheet.left - width - 8;
    else top = canvas.top - height - 6;
    toolbar.style.left =
      Math.max(8, Math.min(innerWidth - width - 8, left)) + "px";
    toolbar.style.top =
      Math.max(8, Math.min(innerHeight - height - 8, top)) + "px";
  }
  function show() {
    if (!getAnchor()) return;
    toolbar.hidden = false;
    sync();
  }
  function hide() {
    toolbar.hidden = true;
  }
  document.addEventListener("pointerdown", (e) => {
    if (!toolbar.contains(e.target)) hide();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
  window.addEventListener("resize", sync);
  document.addEventListener("scroll", sync, true);
  toolbar.addEventListener("keydown", (e) => {
    const buttons = [...toolbar.children],
      index = buttons.indexOf(document.activeElement);
    if (["ArrowRight", "ArrowLeft"].includes(e.key)) {
      e.preventDefault();
      buttons[(index + (e.key === "ArrowRight" ? 1 : 2)) % 3].focus();
    }
  });
  return { show, hide, sync };
}
export function createDeleteConfirmation() {
  const dialog = document.createElement("dialog");
  dialog.id = "deleteItemsDialog";
  dialog.className = "delete-items-dialog";
  dialog.setAttribute("aria-labelledby", "deleteItemsTitle");
  dialog.setAttribute("aria-describedby", "deleteItemsMessage");
  dialog.innerHTML = `<h2 id="deleteItemsTitle">ยืนยันการลบชิ้นงาน</h2><p id="deleteItemsMessage"></p><p class="hint">ลบแล้วสามารถกด Ctrl/Cmd+Z เพื่อย้อนกลับได้</p><div class="confirm-actions"><button type="button" id="cancelDeleteItems" autofocus>ยกเลิก</button><button type="button" id="confirmDeleteItems" class="danger">${icon("trash")}ลบชิ้นงาน</button></div>`;
  document.body.append(dialog);
  let resolve;
  function finish(value) {
    dialog.close();
    const done = resolve;
    resolve = null;
    done?.(value);
  }
  dialog.querySelector("#cancelDeleteItems").onclick = () => finish(false);
  dialog.querySelector("#confirmDeleteItems").onclick = () => finish(true);
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    finish(false);
  });
  return {
    ask(message) {
      if (dialog.open) return Promise.resolve(false);
      dialog.querySelector("#deleteItemsMessage").textContent = message;
      dialog.showModal();
      dialog.querySelector("#cancelDeleteItems").focus();
      return new Promise((done) => (resolve = done));
    },
  };
}
