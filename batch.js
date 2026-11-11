import { clone } from "./model.js";
export function defaultText(item) {
  return {
    text: "ข้อความใหม่",
    size: 5,
    x: item.outer / 2,
    y: item.outer * 0.7,
    color: "#172033",
    font: "sans",
    weight: "normal",
    rotation: 0,
  };
}
// Match text layers by index. Missing layers are created from the primary layer,
// scaled to the target's physical size, while unrelated layers remain intact.
export function ensureTextLayer(target, index, source, sourceOuter) {
  while (target.texts.length <= index) target.texts.push(defaultText(target));
  if (source)
    target.texts[index] = {
      ...clone(source),
      x: (source.x * target.outer) / sourceOuter,
      y: (source.y * target.outer) / sourceOuter,
    };
  return target.texts[index];
}
export function setBatchProperty(items, key, value) {
  for (const item of items) item[key] = clone(value);
}
