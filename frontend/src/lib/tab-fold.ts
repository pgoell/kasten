/**
 * Which tabs the strip draws and which go behind "N more", from how wide each one is.
 *
 * Tabs are taken from the left while they fit in `room`, with `more` px kept
 * back for the "N more" button, and only when something is left over: a strip
 * that fits every tab has no button to make room for. The active tab is always
 * drawn. When it would fall behind the button it takes the place of the last
 * tab drawn, so the tabs on screen keep their order.
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
  if (!shown.includes(active)) shown = [...shown.slice(0, -1), active];
  return { shown, hidden: all.filter((index) => !shown.includes(index)) };
}
