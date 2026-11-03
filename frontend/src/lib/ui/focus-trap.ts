const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keeps Tab and Shift Tab inside `box`, wrapping at either end. True when it took the key. */
export function trapTab(event: KeyboardEvent | React.KeyboardEvent, box: HTMLElement): boolean {
  if (event.key !== "Tab" || event.ctrlKey || event.altKey || event.metaKey) return false;
  const stops = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (first === undefined || last === undefined) {
    event.preventDefault();
    box.focus();
    return true;
  }
  const at = document.activeElement;
  const inside = at instanceof Node && box.contains(at) && at !== box;
  if (event.shiftKey && (!inside || at === first)) {
    event.preventDefault();
    last.focus();
    return true;
  }
  if (!event.shiftKey && (!inside || at === last)) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}
