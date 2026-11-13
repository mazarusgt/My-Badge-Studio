import { icon } from "./ui-icons.js";
export function initSidebarResets({ reset }) {
  const buttons = [];
  for (const input of document.querySelectorAll(
    "#itemSettings input,#itemSettings select,#itemSettings textarea",
  )) {
    if (
      !input.id ||
      (input.id.endsWith("Unit") && input.id !== "pageUnit") ||
      input.type === "range" ||
      input.type === "file"
    )
      continue;
    const label = input.closest("label");
    if (!label) continue;
    const title = label.textContent.trim().split("\n")[0] || input.id;
    let caption = label.querySelector(".property-caption");
    if (!caption) {
      caption = document.createElement("span");
      caption.className = "setting-caption";
      const text = label.firstChild;
      if (text?.nodeType === Node.TEXT_NODE) {
        caption.textContent = text.textContent.trim();
        text.remove();
      }
      if (input.type === "checkbox") {
        const nodes = [...label.childNodes].filter(
          (n) => n.nodeType === Node.TEXT_NODE,
        );
        caption.textContent = nodes
          .map((n) => n.textContent)
          .join("")
          .trim();
        nodes.forEach((n) => n.remove());
      }
      label.prepend(caption);
      if (input.type === "checkbox") label.prepend(input);
    }
    caption.classList.add("reset-caption");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sidebar-reset action-icon";
    button.dataset.resetSetting = input.id;
    button.title = "คืนค่าเริ่มต้น: " + title;
    button.setAttribute("aria-label", button.title);
    button.innerHTML = icon("reset");
    button.addEventListener("click", (e) => {
      e.preventDefault();
      reset(input.id);
    });
    caption.append(button);
    buttons.push({ button, input });
  }
  return {
    sync() {
      for (const { button, input } of buttons) button.disabled = input.disabled;
    },
  };
}
