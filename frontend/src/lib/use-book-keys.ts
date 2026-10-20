import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { type EditorCommands, TERMINAL, TERMINAL_CHORD } from "@/lib/key-bindings";
import type { BookTake } from "@/lib/use-book-take";
import type { BookTurns } from "@/lib/use-book-turns";

/**
 * The keys the book pane answers, attached to its wrapper.
 *
 * Returns the handler, which the view's own effect also hangs on every section
 * the book shows. It keeps one identity for the life of the pane.
 */
export function useBookKeys(o: {
  wrapper: RefObject<HTMLDivElement | null>;
  commands: EditorCommands;
  contentsOpen: RefObject<boolean>;
  turn: BookTurns["turn"];
  take: BookTake["take"];
  openContents: () => void;
}): (event: KeyboardEvent) => void {
  const { wrapper, commands, contentsOpen, turn, take, openContents } = o;
  // Read through a ref, the way `terminal-pane.tsx` reads the same prop. The
  // view is built in one effect keyed on the bytes, and naming these in its
  // dependencies would rebuild it every time the route's memo took a new
  // identity, which is on every vault write.
  //
  // Written in a layout effect, which runs in the commit's own task, so a key
  // heard between the commit and the passive effects runs the new command.
  const commandsRef = useRef(commands);
  useLayoutEffect(() => {
    commandsRef.current = commands;
  });

  /**
   * Every key the reader answers, whichever document it was pressed in.
   *
   * The modifiers are compared for equality rather than tested for truth, the
   * way `terminal-pane.tsx` compares them: Chrome spends `Ctrl+H` on its
   * history window, and a handler reading `event.key` alone would turn that
   * into a page turn.
   */
  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // The contents render inside the wrapper, whose listener is a native one,
      // while React delegates every event from the root container above it. So a
      // key pressed in the contents reaches this handler first, and without this
      // `q` in there closes the reader and `l` turns a page behind the panel.
      if (contentsOpen.current) return;

      const chord =
        event.ctrlKey === TERMINAL_CHORD.ctrlKey &&
        event.shiftKey === TERMINAL_CHORD.shiftKey &&
        event.altKey === TERMINAL_CHORD.altKey &&
        event.metaKey === TERMINAL_CHORD.metaKey;

      if (chord) {
        // From `TERMINAL` rather than a table of this pane's own, so retuning a
        // chord retunes both panes.
        const binding = TERMINAL.find((row) => row.key === event.key);
        if (binding === undefined) return;
        event.preventDefault();
        commandsRef.current[binding.command]();
        return;
      }

      if (event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return;

      // No leader: the pane holds a document you page with the space bar in every
      // other reader, and the chords already carry the way out.
      if (event.key === "l" || event.key === "h") turn(event.key === "l" ? "next" : "prev");
      else if (event.key === "q") commandsRef.current.closeNote();
      // vim's own key for writing what you are looking at out to a file, said
      // bare for the reason `q` is: this pane has no leader.
      else if (event.key === "w") commandsRef.current.exportNote();
      // Nothing selected is nothing to take, the way `t` on a book still opening
      // is nothing to draw.
      else if (event.key === "y") void take();
      else if (event.key === "t") openContents();
      else return;

      event.preventDefault();
      // `take` and `openContents` are the only names here that are not refs,
      // and each is a `useCallback` with no dependencies of its own, so this
      // handler's identity is still fixed for the life of the pane and the view
      // effect naming it rebuilds nothing.
    },
    [contentsOpen, take, openContents, turn],
  );

  // On the wrapper as well as on every section, and in an effect of its own so
  // it survives a book that never opened: the error panel answers `q` too.
  useEffect(() => {
    const element = wrapper.current;
    element?.addEventListener("keydown", onKeyDown);
    return () => element?.removeEventListener("keydown", onKeyDown);
  }, [onKeyDown, wrapper]);

  return onKeyDown;
}
