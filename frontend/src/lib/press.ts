/** Rows, tabs and links give under the finger too, as buttons do. */
const PRESSABLE = "button, [role=button], [role=tab], a[href], summary";

const DISABLED = ":disabled, [aria-disabled='true']";

// Chrome sends no pointerup once a context menu opens on mousedown.
const ENDS = ["pointerup", "pointercancel", "lostpointercapture", "contextmenu"] as const;

/**
 * Marks the pressed control `data-pressed`, which app.css styles. One document
 * listener, so later controls need no hook. Every end of press clears all marks,
 * so a control swapped mid-press cannot keep one.
 */
export function startPress(root: Document = document): () => void {
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    const control = event.target.closest(PRESSABLE);
    if (!control || control.matches(DISABLED)) return;
    control.setAttribute("data-pressed", "");
  };
  const clear = () => {
    root.querySelectorAll("[data-pressed]").forEach((marked) => {
      marked.removeAttribute("data-pressed");
    });
  };

  root.addEventListener("pointerdown", down, true);
  for (const type of ENDS) root.addEventListener(type, clear, true);

  return () => {
    root.removeEventListener("pointerdown", down, true);
    for (const type of ENDS) root.removeEventListener(type, clear, true);
  };
}
