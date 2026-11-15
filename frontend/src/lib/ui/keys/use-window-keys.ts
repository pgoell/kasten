import { useEffect, useState } from "react";
import { TERMINAL_CHORD } from "./key-bindings";

/**
 * Whether a key typed here belongs to the text in front of it. In a note's editor `?` stays vim's
 * own (a backward search, or a question mark), and everywhere else it asks for the key help.
 */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return (
    target.closest(
      "input, textarea, select, [contenteditable]:not([contenteditable='false']), .cm-editor, .xterm",
    ) !== null
  );
}

/**
 * Whether the key help is up, and a `?` outside a text field raises it. Bubble phase on the window,
 * so a panel that handles `?` and calls preventDefault keeps it.
 */
export function useKeyHelp() {
  const [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "?") return;
      if (event.ctrlKey || event.altKey || event.metaKey || isTyping(event.target)) return;
      event.preventDefault();
      setHelpOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return [helpOpen, setHelpOpen] as const;
}

/**
 * The palette's chord wherever the focus sits, a button or a pane with no keys of its own among
 * them (#2068). The editor, a terminal and a book take it first and call preventDefault; a modal
 * dialog keeps it, so no palette opens over a prompt. A chord types nothing, so a text field gets it.
 */
export function usePaletteChord(openPalette: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "P") return;
      if (
        (Object.keys(TERMINAL_CHORD) as (keyof typeof TERMINAL_CHORD)[]).some(
          (modifier) => event[modifier] !== TERMINAL_CHORD[modifier],
        )
      )
        return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]') !== null) return;
      event.preventDefault();
      openPalette();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openPalette]);
}
