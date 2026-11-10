import { useEffect, useState } from "react";

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
