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

// Whether a key is down now, and the work waiting for it to come up. See
// `whenKeysUp`.
let keyHeld = false;
const waiting: (() => void)[] = [];

function keysUp(): void {
  keyHeld = false;
  for (const run of waiting.splice(0)) run();
}

window.addEventListener(
  "pointerdown",
  (event) => {
    touched = event.pointerType === "touch";
    keysUp();
  },
  true,
);
window.addEventListener(
  "keydown",
  () => {
    touched = false;
    keyHeld = true;
  },
  true,
);
window.addEventListener("keyup", keysUp, true);
// A key let go while the window was away sends no keyup to this page.
window.addEventListener("blur", keysUp);

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

/**
 * Runs `run` once no key is down: now when none is, else when the held key comes up.
 *
 * A file picker opened inside a keydown starts while that key is still down.
 * The browser hides the pointer while someone types, so the picker opens with
 * no pointer to pick with. The keyup still sits inside the browser's transient
 * activation window, so the picker still opens from there (#692).
 */
export function whenKeysUp(run: () => void): void {
  if (keyHeld) waiting.push(run);
  else run();
}
