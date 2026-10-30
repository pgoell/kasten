/**
 * Splits tabs into those drawn and those behind "N more". `more` px of `room` is kept
 * for the button, and only when a tab is hidden. The active tab is always drawn; order is kept.
 */
export function foldTabs(
  widths: readonly number[],
  room: number,
  active: number,
  more: number,
): { shown: number[]; hidden: number[] } {
  const all = widths.map((_, index) => index);
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (total <= room) return { shown: all, hidden: [] };

  let used = 0;
  let count = 0;
  for (const width of widths) {
    if (used + width > room - more) break;
    used += width;
    count += 1;
  }

  let shown = all.slice(0, count);
  if (!shown.includes(active)) {
    // The active tab takes a place beside the kept tabs; tabs go from the right until both fit.
    // Alone it may still be too wide; the strip caps it, so it never runs under the button.
    const width = (indices: number[]) =>
      indices.reduce((sum, index) => sum + (widths[index] ?? 0), 0);
    while (shown.length > 0 && width([...shown, active]) > room - more) shown = shown.slice(0, -1);
    shown = [...shown, active];
  }
  return { shown, hidden: all.filter((index) => !shown.includes(index)) };
}
