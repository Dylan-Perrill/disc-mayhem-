// Tiny DOM + formatting helpers shared by the UI module. No three.js, no deps.

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// 0xff6b6b (number) or '#ff6b6b' (string) -> css color string.
export function cssColor(c) {
  if (typeof c === 'number') return '#' + (c >>> 0).toString(16).padStart(6, '0');
  return String(c);
}

// ms -> "m:ss"
export function fmtTime(ms) {
  const totalSec = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m + ':' + String(s).padStart(2, '0');
}
