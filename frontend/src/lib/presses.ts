/**
 * Whether the last press anywhere followed a link, and whether the press now
 * down may repeat it (#569).
 *
 * One for the module, kept by one listener on the document in the capture
 * phase, rather than one per view: a press on a widget never reaches the
 * view's own handlers, a press may land in another pane, and a follow rebuilds
 * the view for the note it opens, under the second press of a double tap.
 */
export const presses = { followed: false, repeat: false };
let watchingPresses = false;

export function watchPresses(): void {
  if (watchingPresses) return;
  watchingPresses = true;
  document.addEventListener(
    "pointerdown",
    () => {
      presses.repeat = presses.followed;
      presses.followed = false;
    },
    true,
  );
}
