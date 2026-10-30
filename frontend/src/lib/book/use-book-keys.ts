import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { FoliateView } from "@/lib/book/foliate-view";
import type { BookTake } from "@/lib/book/use-book-take";
import type { BookTurns } from "@/lib/book/use-book-turns";
import { type EditorCommands, TERMINAL, TERMINAL_CHORD } from "@/lib/key-bindings";
import { beginLeader, paneOpener } from "@/lib/which-key";

/**
 * The keys the book pane answers, attached to its wrapper. Returns the handler, which the view's
 * effect also hangs on every section, and which keeps one identity for the life of the pane.
 */
export function useBookKeys(o: {
  wrapper: RefObject<HTMLDivElement | null>;
  viewRef: RefObject<FoliateView | null>;
  commands: EditorCommands;
  contentsOpen: RefObject<boolean>;
  turn: BookTurns["turn"];
  scroll: BookTurns["scroll"];
  take: BookTake["take"];
  openContents: () => void;
}): (event: KeyboardEvent) => void {
  const { wrapper, viewRef, commands, contentsOpen, turn, scroll, take, openContents } = o;
  // Read through a ref: naming these in the view effect's dependencies would rebuild the view on every vault write.
  // A layout effect, so a key pressed before the passive effects still runs the new command.
  const commandsRef = useRef(commands);
  useLayoutEffect(() => {
    commandsRef.current = commands;
  });

  /**
   * Every key the reader answers, whichever document it was pressed in. Modifiers compare for equality,
   * since a bare `event.key` read would turn Ctrl+H, Chrome's history key, into a page turn.
   */
  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Keys pressed in the contents reach this native listener first, so without
      // this `q` closes the reader and `l` turns a page behind the panel.
      if (contentsOpen.current) return;

      const chord =
        event.ctrlKey === TERMINAL_CHORD.ctrlKey &&
        event.shiftKey === TERMINAL_CHORD.shiftKey &&
        event.altKey === TERMINAL_CHORD.altKey &&
        event.metaKey === TERMINAL_CHORD.metaKey;

      if (chord) {
        // From `TERMINAL`, so retuning a chord retunes both panes.
        const binding = TERMINAL.find((row) => row.key === event.key);
        if (binding === undefined) return;
        event.preventDefault();
        commandsRef.current[binding.command]();
        return;
      }

      // `?` is shift and `/`, so it is read before the modifier check.
      if (event.key === "?" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        commandsRef.current.showHelp();
        return;
      }

      if (event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return;

      // Leader on every page (#776). Space turns no page here, so it opens the panel.
      // The wrapper and not the focused element: the foliate host takes no focus.
      if (event.key === " ") {
        if (beginLeader(paneOpener(commandsRef.current, wrapper.current))) {
          event.preventDefault();
        }
        return;
      }
      if (event.key === "l" || event.key === "h") turn(event.key === "l" ? "next" : "prev");
      else if (event.key === "j" || event.key === "k") scroll(event.key === "j" ? "down" : "up");
      // Clear the selection in every document and hand the keys back to Kasten.
      // The book's frame holds the focus, which the app's keys do not reach.
      else if (event.key === "Escape") {
        for (const { doc } of viewRef.current?.renderer?.getContents?.() ?? [])
          doc.getSelection()?.removeAllRanges();
        wrapper.current?.focus();
      } else if (event.key === "q") commandsRef.current.closeNote();
      // vim's key for writing out a file, said bare like `q`.
      else if (event.key === "w") commandsRef.current.exportNote();
      // Nothing selected is nothing to take.
      else if (event.key === "y") void take();
      else if (event.key === "t") openContents();
      else return;

      event.preventDefault();
      // `take` and `openContents` are the only non-refs here. Each is a no-dependency
      // `useCallback`, so this handler's identity stays fixed for the life of the pane.
    },
    [contentsOpen, take, openContents, turn, scroll, viewRef, wrapper],
  );

  // Its own effect, so it survives a book that never opened: the error panel answers `q` too.
  useEffect(() => {
    const element = wrapper.current;
    element?.addEventListener("keydown", onKeyDown);
    return () => element?.removeEventListener("keydown", onKeyDown);
  }, [onKeyDown, wrapper]);

  return onKeyDown;
}
