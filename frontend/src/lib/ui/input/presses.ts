/**
 * What the last press followed, and what the press now down may repeat (#569, #572).
 * One capture listener on the document: a widget press skips view handlers, and a
 * press may land in another pane.
 */
export const presses: { followed: string | null; repeat: string | null } = {
  followed: null,
  repeat: null,
};

/**
 * Key for every followed note. A follow rebuilds the view, so a double tap's second
 * tap lands on another link and still repeats the first.
 */
export const NOTE = "\u0000note";

let watchingPresses = false;

export function watchPresses(): void {
  if (watchingPresses) return;
  watchingPresses = true;
  document.addEventListener(
    "pointerdown",
    () => {
      presses.repeat = presses.followed;
      presses.followed = null;
    },
    true,
  );
}

/**
 * Whether a click that follows `key` repeats the press before it, so follows nothing.
 * Chrome calls a press near the last its second, and a repeat only if that press
 * followed the same key or a note, since that redraws the view. Either way it counts
 * as followed, so a third press repeats too.
 */
export function repeats(event: MouseEvent, key: string): boolean {
  const again = event.detail > 1 && (presses.repeat === NOTE || presses.repeat === key);
  presses.followed = key;
  return again;
}
