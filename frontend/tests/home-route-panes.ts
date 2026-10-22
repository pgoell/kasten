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
