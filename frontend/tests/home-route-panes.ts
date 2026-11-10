/**
 * Which pane a route draws as the focused one, by position.
 *
 * The accent line marks it when panes sit beside each other. A lone pane or a
 * zoomed one has no line, and every other pane is hidden, so the one left drawn
 * is the focused one.
 */
export function focusedPaneOf(container: HTMLElement): number {
  const panes = [...container.querySelectorAll<HTMLElement>("[data-pane]")];
  const marked = panes.findIndex(
    (pane) => pane.querySelector("[data-focus-line].bg-k-accent") !== null,
  );
  if (marked !== -1) return marked;
  // With no line, the pane drawn alone is the focused one; two drawn panes and no line name none.
  const shown = panes.filter((pane) => !pane.classList.contains("hidden"));
  const [only] = shown;
  return shown.length === 1 && only !== undefined ? panes.indexOf(only) : -1;
}

/**
 * The open palette's row whose text matches `name`. By text, since a role query
 * by name runs a style cascade for each node of every row: past 5 s under load (#1641).
 */
export function paletteRow(name: RegExp): Element | undefined {
  const rows = document.querySelectorAll("[role='listbox'][aria-label='Commands'] [role='option']");
  return [...rows].find((row) => name.test(row.textContent ?? ""));
}

/** A note finder row by its path, as its text shows the name and folder apart. */
export const finderRow = (path: string) =>
  document.querySelector(`[role="option"][data-path="${path}"]`);
