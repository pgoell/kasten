import { EditorView } from "@codemirror/view";
import { useEffect, useState } from "react";
import type { EditorCommands } from "@/lib/key-bindings";
import { beginLeader, editorOpener, paneOpener } from "@/lib/which-key";

/**
 * Whether a key typed here belongs to the text in front of it. A note's editor
 * is one, so `?` in a note stays vim's own: a backward search in normal mode, a
 * question mark in insert mode. Everywhere else `?` asks for the key help.
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
 * Whether the key help is up, and a `?` outside a text field raises it. Bubble
 * phase on the window, so a panel or a field that handles `?` itself (and calls
 * preventDefault) keeps it. Only a key nothing else took opens help.
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
 * Opens the which-key panel from the toolbar's space button. The focus is where
 * the reader last typed, which is the editor when one is focused. The toolbar's
 * buttons never take it, so it is not moved here.
 */
export function leaderFromFocus(commands: EditorCommands) {
  const focused = document.activeElement;
  const view = focused instanceof HTMLElement ? EditorView.findFromDOM(focused) : null;
  beginLeader(view ? editorOpener(view, commands) : paneOpener(commands));
}
