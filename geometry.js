export const units = { mm: 1, cm: 10, inch: 25.4 };
export function convert(value, from, to) {
  return (value * units[from]) / units[to];
}
export function arrange({ width, height, diameter, gapX, gapY, margin }) {
  if (
    ![width, height, diameter, gapX, gapY, margin].every(Number.isFinite) ||
    diameter <= 0 ||
    width <= 0 ||
    height <= 0 ||
    Math.min(gapX, gapY, margin) < 0
  )
    throw Error("ขนาดไม่ถูกต้อง");
  const cols = Math.max(
    0,
    Math.floor((width - 2 * margin + gapX) / (diameter + gapX)),
  );
  const rows = Math.max(
    0,
    Math.floor((height - 2 * margin + gapY) / (diameter + gapY)),
  );
  if (cols * rows > 2000)
    throw Error("จำนวนเกิน 2,000 ชิ้นต่อหน้า กรุณาปรับขนาด");
  return Array.from({ length: cols * rows }, (_, i) => ({
    x: margin + (i % cols) * (diameter + gapX),
    y: margin + Math.floor(i / cols) * (diameter + gapY),
  }));
}
