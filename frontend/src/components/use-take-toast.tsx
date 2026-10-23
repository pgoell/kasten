import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from "react";
import { TakeToast } from "@/components/take-toast";
import { noteName } from "@/lib/note-path";
import { writePassage } from "@/lib/page-highlight";
import { type Undo, undoPassage } from "@/lib/page-undo";

/** A passage held for a take, as the toast shows it. */
export interface ToastTaking {
  /** What the reader selected, unformatted: the dump's quote, the toast and a note's highlight. */
  text: string;
  /**
   * The link back to the passage's place, written relative to the note it lands in:
   * the daily note for the dump, the chosen note for Put it in a note.
   */
  linkIn: (note: string) => string;
  /** The toast's source line: a heading, or the page's own name. */
  source: string;
  /** The passage sat in the lower half of its frame, so the toast goes to the top (#885). */
  top: boolean;
}

/** The toast on screen: what it says, and the take it can undo, if it can. */
interface Toast extends ToastTaking {
  id: number;
  title: string;
  undo?: Undo;
}

export interface TakeToastOptions {
  /** Whether the recent notes list includes archived notes, as the home screen's does. */
  archive: boolean;
  /** The toast's line when an Undo leaves the note as it was. */
  refused: string;
  /** What an Undo takes out of the note. The dump's line when left out. */
  without?: (text: string, quote: string) => string | null;
  /** Called with the take's id once its Undo has taken its mark off. */
  onUnmarked: (id: number) => void;
}

/**
 * The toast a take shows, and the wiring behind it: Undo, Put it in a note and
 * the generation that tells a pane it has moved on. Shared by the dump take and
 * the book's note take, so the two cannot drift apart.
 */
export function useTakeToast(o: TakeToastOptions): {
  /** Show `title` for `taking`, with an Undo when `undo` is given. */
  show: (title: string, taking: ToastTaking, undo?: Undo) => void;
  /** Read before an await, then given to `moved` after it. */
  generation: () => number;
  /** Whether the pane has forgotten its document since `since` was read. */
  moved: (since: number) => boolean;
  /** Drop the toast (a new document in the pane). */
  forget: () => void;
  /** The toast, or null; the pane renders it inside its wrapper. */
  toast: ReactNode;
} {
  const [toast, setToast] = useState<Toast | null>(null);
  const toastId = useRef(0);
  // Read through a ref, so a pane's new callbacks are the ones called. Written in
  // a layout effect, the way the panes write theirs.
  const options = useRef(o);
  useLayoutEffect(() => {
    options.current = o;
  });

  // Bumped by a new document, so a take still in flight can tell the pane moved on.
  const gen = useRef(0);
  const generation = useCallback(() => gen.current, []);
  const moved = useCallback((since: number) => since !== gen.current, []);
  const forget = useCallback(() => {
    gen.current += 1;
    setToast(null);
  }, []);

  function show(title: string, taking: ToastTaking, undo?: Undo) {
    toastId.current += 1;
    const { text, linkIn, source, top } = taking;
    setToast({ id: toastId.current, title, text, linkIn, source, top, undo });
  }

  /**
   * Take the passage back out of its note, if the note has not changed since the
   * take. The read and the write are the undo's own (`undoPassage`), so a write
   * that landed in between is refused, not overwritten.
   */
  async function undoTake(undo: Undo) {
    const { without, refused, onUnmarked } = options.current;
    const outcome = await undoPassage(undo, without);
    if (outcome.state === "undone") {
      onUnmarked(undo.id);
      setToast(null);
      return;
    }
    // The toast says why Undo did nothing, and loses the Undo it can no longer make.
    const title = outcome.state === "refused" ? refused : outcome.message;
    setToast((current) => current && { ...current, title, undo: undefined });
  }

  /** Write the passage under `## Highlights` in a note the reader picked. The take stays where it is. */
  function putInto(id: number, notePath: string, taken: Toast) {
    void writePassage(notePath, taken.text, taken.linkIn(notePath)).then(
      () =>
        setToast((current) =>
          current?.id === id ? { ...current, title: `Put into ${noteName(notePath)}` } : current,
        ),
      (error: unknown) =>
        setToast((current) =>
          current?.id === id
            ? { ...current, title: error instanceof Error ? error.message : "Not written" }
            : current,
        ),
    );
  }

  const undo = toast?.undo;
  const element =
    toast === null ? null : (
      <TakeToast
        key={toast.id}
        top={toast.top}
        title={toast.title}
        passage={toast.text}
        source={toast.source}
        archive={o.archive}
        onUndo={undo === undefined ? undefined : () => void undoTake(undo)}
        onPut={(notePath) => putInto(toast.id, notePath, toast)}
        onDone={forget}
      />
    );

  return { show, generation, moved, forget, toast: element };
}
