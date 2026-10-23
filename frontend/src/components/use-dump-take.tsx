import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from "react";
import { TakeToast } from "@/components/take-toast";
import { readClock } from "@/lib/clock";
import { noteName } from "@/lib/note-path";
// Renamed for the reason `use-prompts.tsx` renames it: the take is a dump, and
// the page has no other `flush` to confuse it with.
import { flush as flushOutbox, keep } from "@/lib/outbox";
import { writePassage } from "@/lib/page-highlight";
import { REFUSED, type Undo, undoFor, undoPassage } from "@/lib/page-undo";
import { periodicNote } from "@/lib/periodic";

/** A passage held for a take, as the pane names it: the dump's text and where it came from. */
export interface Taking {
  /** The dump paragraph, escaped and linked, as `quoteBlock` writes it. */
  quote: string;
  /** What the reader selected, unformatted, for the toast and for a note's highlight. */
  text: string;
  /** The link back to the passage's place, the chapter line of a highlight. */
  link: string;
  /** The toast's source line: a heading, or the page's own name. */
  source: string;
  /** The passage sat in the lower half of its frame, so the toast goes to the top (#885). */
  top: boolean;
  /** Called with this take's id once it is kept, for what this take alone holds. */
  onKept?: (id: number) => void;
}

/** The toast on screen: what it says, and the take it can undo, if it can. */
interface Toast {
  id: number;
  title: string;
  text: string;
  link: string;
  source: string;
  top: boolean;
  undo?: Undo;
}

/**
 * The one dump write path of a take out of a vault page, whichever pane it
 * comes from: kept on the device, sent by the outbox, undone out of the daily
 * note if it landed, and put into a note of the reader's choice.
 *
 * `onMarked` is called once the words are safe on the device, which is the only
 * point at which the selection may be called taken. `onUnmarked` is called when
 * the take's Undo has taken the dump line back out. Each is given the take's id.
 */
export function useDumpTake(o: {
  archive: boolean;
  onMarked: (id: number) => void;
  onUnmarked: (id: number) => void;
}): {
  /** Keep it on the device, mark it (onMarked) once kept, send it, show the toast. False when it was not kept; the toast says why. */
  take(taking: Taking): Promise<boolean>;
  /** Drop the toast (a new document in the pane). */
  forget(): void;
  /** The toast, or null; the pane renders it inside its wrapper. */
  toast: ReactNode;
} {
  const { archive, onMarked, onUnmarked } = o;
  const [toast, setToast] = useState<Toast | null>(null);
  // The take's mark, counted per pane so each take has its own id.
  const marks = useRef(0);
  const toastId = useRef(0);
  // Read through refs, so a pane's new callbacks are the ones called. Written in
  // a layout effect, the way the panes write theirs.
  const markedRef = useRef(onMarked);
  const unmarkedRef = useRef(onUnmarked);
  useLayoutEffect(() => {
    markedRef.current = onMarked;
    unmarkedRef.current = onUnmarked;
  });

  const forget = useCallback(() => setToast(null), []);

  function show(title: string, taking: Taking, undo?: Undo) {
    toastId.current += 1;
    const { text, link, source, top } = taking;
    setToast({ id: toastId.current, title, text, link, source, top, undo });
  }

  async function take(taking: Taking): Promise<boolean> {
    const now = new Date();
    const daily = periodicNote("daily", now).path;
    marks.current += 1;
    const id = marks.current;

    const dump = await keep(taking.quote, readClock(now).date).then(
      (kept) => kept,
      (error: unknown) => {
        show(error instanceof Error ? error.message : "The take was not kept", taking);
        return null;
      },
    );
    if (dump === null) return false;

    markedRef.current(id);
    taking.onKept?.(id);
    // The same answers `capture` gives, in the take's words.
    const { waiting, failure } = await flushOutbox();
    const mine = waiting.find((each) => each.id === dump.id);
    if (mine === undefined) {
      show("Taken into today's dump", taking, await undoFor(daily, taking.quote, id));
    } else if (mine.refused !== undefined) {
      show(mine.refused, taking);
    } else if (failure?.kind === "sign-in") {
      show("Taken, waiting to send: sign in again", taking);
    } else {
      show(`Taken, waiting to send (${waiting.length} waiting)`, taking);
    }
    return true;
  }

  /**
   * Take the dump line back out of the daily note, if the note has not changed
   * since the take. It is read again first and written under the base it was
   * read with, so a write that landed in between is refused, not overwritten.
   */
  async function undoTake(undo: Undo) {
    const outcome = await undoPassage(undo);
    if (outcome.state === "undone") {
      unmarkedRef.current(undo.id);
      setToast(null);
      return;
    }
    // The toast says why Undo did nothing, and loses the Undo it can no longer make.
    const title = outcome.state === "refused" ? REFUSED : outcome.message;
    setToast((current) => current && { ...current, title, undo: undefined });
  }

  /** Write the passage under `## Highlights` in a note the reader picked. The dump line stays where it is. */
  function putInto(id: number, notePath: string, taken: Toast) {
    void writePassage(notePath, taken.text, taken.link).then(
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
        archive={archive}
        onUndo={undo === undefined ? undefined : () => void undoTake(undo)}
        onPut={(notePath) => putInto(toast.id, notePath, toast)}
        onDone={forget}
      />
    );

  return { take, forget, toast: element };
}
