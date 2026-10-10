/**
 * Whether the last thing the reader did was put a finger on the screen.
 *
 * An editor that takes the focus raises the on-screen keyboard, and the app
 * hands an editor the focus whenever a pane is moved to or a note is opened.
 * After a key that is right: whoever pressed it has a keyboard, on screen or
 * on the desk, and goes on typing. After a tap it costs half the screen for
 * keys nobody reached for. So the question is asked of the input, not of the
 * device: a tablet with a keyboard attached answers both ways in one minute.
 *
 * One pair of listeners for the page, in the capture phase so a handler that
 * stops the event further down cannot hide it from here.
 *
 * Before any input the pointer answers for it. A phone that has just loaded
 * the page has been neither tapped nor typed at, and an editor focused then
 * would be the opener every overlay hands the focus back to, keyboard and all.
 */
let touched = window.matchMedia("(pointer: coarse)").matches;

window.addEventListener(
  "pointerdown",
  (event) => {
    touched = event.pointerType === "touch";
  },
  true,
);
window.addEventListener(
  "keydown",
  () => {
    touched = false;
  },
  true,
);

export function lastInputWasTouch(): boolean {
  return touched;
}
