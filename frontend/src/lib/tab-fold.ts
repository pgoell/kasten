/**
 * Which tabs the strip draws and which go behind "N more", from how wide each one is.
 *
 * Tabs are taken from the left while they fit in `room`, with `more` px kept
 * back for the "N more" button, and only when something is left over: a strip
 * that fits every tab has no button to make room for. The active tab is always
 * drawn. When it would fall behind the button it takes a place at the end of
 * those drawn, after tabs have gone from the right until it fits, so the tabs
 * on screen keep their order.
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
    // The active tab takes a place beside the tabs that stay, so tabs go from the
    // right until those and the active tab fit. Alone it may still be too wide: it
    // is then capped at the room by the strip, and never runs under the button.
    const width = (indices: number[]) =>
      indices.reduce((sum, index) => sum + (widths[index] ?? 0), 0);
    while (shown.length > 0 && width([...shown, active]) > room - more) shown = shown.slice(0, -1);
    shown = [...shown, active];
  }
  return { shown, hidden: all.filter((index) => !shown.includes(index)) };
}
