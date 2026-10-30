import { NARROW } from "@/lib/use-viewport";

/**
 * Whether the last input was a finger on the screen. A focused editor raises the on-screen
 * keyboard, which after a tap costs half the screen. Asked of the input, not the device: a tablet
 * with a keyboard answers both ways. Before any input, the pointer answers.
 */
let touched = window.matchMedia("(pointer: coarse)").matches;

// Keys down now, and work waiting for them to come up (see `whenKeysUp`). A set, not a flag:
// one key up must not free the work while another is still down.
const held = new Set<string>();
const waiting: (() => void)[] = [];

function keyOf(event: KeyboardEvent): string {
  return event.code || event.key;
}

function runWaiting(): void {
  if (held.size > 0) return;
  for (const run of waiting.splice(0)) run();
}

// Capture phase, so a handler further down that stops an event cannot hide it.
window.addEventListener(
  "pointerdown",
  (event) => {
    touched = event.pointerType === "touch";
    held.clear();
    runWaiting();
  },
  true,
);
window.addEventListener(
  "keydown",
  (event) => {
    touched = false;
    held.add(keyOf(event));
  },
  true,
);
window.addEventListener(
  "keyup",
  (event) => {
    // macOS sends no keyup for keys pressed with Cmd down, so Cmd going up is the only sign.
    if (event.key === "Meta") held.clear();
    held.delete(keyOf(event));
    runWaiting();
  },
  true,
);
// A key let go while the window was away sends no keyup to this page.
window.addEventListener("blur", () => {
  held.clear();
  runWaiting();
});

/**
 * Whether focusing an editor now would raise a keyboard nobody asked for: a tap on a narrow window.
 * On a wide touch screen the tree stays open with focus on the tapped row, so typed keys act on it.
 */
export function keyboardUnasked(): boolean {
  return touched && window.matchMedia(NARROW).matches;
}

/**
 * Runs `run` once no key is down. A file picker opened from a keydown waits for the keyup: the
 * pointer is hidden while typing, and the keyup stays inside the activation window (#692).
 */
export function whenKeysUp(run: () => void): void {
  if (held.size > 0) waiting.push(run);
  else run();
}
