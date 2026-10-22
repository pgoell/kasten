/** The controls a press lands on. A row, a tab or a link gives under the finger as a button does. */
const PRESSABLE = "button, [role=button], [role=tab], a[href], summary";

/** A control that cannot be pressed gives nothing back, so it is not marked. */
const DISABLED = ":disabled, [aria-disabled='true']";

const ENDS = ["pointerup", "pointercancel", "lostpointercapture"] as const;

/**
 * Marks the control under a press with `data-pressed`, which `app.css` turns
 * into the small give. One listener on the document rather than one per
 * control, so a control rendered later is pressed with no hook of its own.
 *
 * The mark is cleared on every way a press can end: a lift, a cancel (a touch
 * that turned into a scroll) and a lost capture. Clearing every mark from the
 * document, not just the one pressed, means a control replaced mid-press cannot
 * keep it.
 */
export function startPress(root: Document = document): () => void {
  const down = (event: PointerEvent) => {
    if (!(event.target instanceof Element)) return;
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
