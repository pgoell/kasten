/**
 * What the last press anywhere followed, and what the press now down may
 * repeat (#569, #572).
 *
 * One for the module, kept by one listener on the document in the capture
 * phase, rather than one per view: a press on a widget never reaches the
 * view's own handlers, a press may land in another pane, and a follow rebuilds
 * the view for the note it opens, under the second press of a double tap.
 */
export const presses: { followed: string | null; repeat: string | null } = {
  followed: null,
  repeat: null,
};

/**
 * The key of every note followed. One for all of them: a follow rebuilds the
 * view, so the link under a double tap's second tap is another one, and that
 * tap is still the first one's repeat.
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
 * Whether a click that follows `key`, an address or `NOTE`, repeats the press
 * before it and so follows nothing. Chrome counts any press close to the one
 * before as its second, so it is a repeat only when that press followed the
 * same. It counts as followed either way, so a third press is a repeat too.
 */
export function repeats(event: MouseEvent, key: string): boolean {
  const again = event.detail > 1 && presses.repeat === key;
  presses.followed = key;
  return again;
}
