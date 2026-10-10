import { NARROW } from "@/lib/use-viewport";

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

/**
 * Whether handing an editor the focus now would raise a keyboard nobody asked for.
 *
 * A tap, and a narrow window. The width matters because of where the focus
 * rests otherwise. On a phone the tree is a drawer that shuts as the note
 * opens, so the focus falls to the body and a stray key does nothing. On a
 * wide touch screen the tree stays open beside the note with the focus on the
 * row just tapped, and the next keys typed would be the tree's: `d` there
 * trashes the row. A wide screen also has the room a keyboard takes.
 */
export function keyboardUnasked(): boolean {
  return touched && window.matchMedia(NARROW).matches;
}
