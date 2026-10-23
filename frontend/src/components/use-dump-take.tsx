import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from "react";
import { TakeToast } from "@/components/take-toast";
import { readClock } from "@/lib/clock";
import { quoteBlock } from "@/lib/html-take";
import { noteName } from "@/lib/note-path";
// Renamed for the reason `use-prompts.tsx` renames it: the take is a dump, and
// the page has no other `flush` to confuse it with.
import { flush as flushOutbox, keep } from "@/lib/outbox";
import { writePassage } from "@/lib/page-highlight";
import { REFUSED, type Undo, undoFor, undoPassage } from "@/lib/page-undo";
import { periodicNote } from "@/lib/periodic";

/** A passage held for a take, as the pane names it: the dump's text and where it came from. */
export interface Taking {
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
  /** Called with this take's id once it is kept, for what this take alone holds. */
  onKept?: (id: number) => void;
}

/** The toast on screen: what it says, and the take it can undo, if it can. */
interface Toast {
  id: number;
  title: string;
  text: string;
  linkIn: (note: string) => string;
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
  /**
   * Keep it on the device, mark it (onMarked) once kept, send it, show the toast.
   * A take the pane forgot (a new document came meanwhile) is still kept and sent,
   * but it is not marked and gets no toast. A failure to keep still shows its
   * error, and then returns true, so the pane does not hold the old passage over
   * the new document. Otherwise false when it was not kept; the toast says why.
   */
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

  // Bumped by a new document, so a take still in flight can tell the pane moved on.
  const generation = useRef(0);
  const forget = useCallback(() => {
    generation.current += 1;
    setToast(null);
  }, []);

  function show(title: string, taking: Taking, undo?: Undo) {
    toastId.current += 1;
    const { text, linkIn, source, top } = taking;
    setToast({ id: toastId.current, title, text, linkIn, source, top, undo });
  }

  async function take(taking: Taking): Promise<boolean> {
    const now = new Date();
    const daily = periodicNote("daily", now).path;
    const quote = quoteBlock(taking.text, taking.linkIn(daily));
    marks.current += 1;
    const id = marks.current;
    // Read before the first await, so a forget() during the keep or the send shows.
    const started = generation.current;
    const moved = () => started !== generation.current;

    const dump = await keep(quote, readClock(now).date).then(
      (kept) => kept,
      (error: unknown) => {
        show(error instanceof Error ? error.message : "The take was not kept", taking);
        return null;
      },
    );
    // The error is shown even over a new document, since the words are saved nowhere else.
    if (dump === null) return moved();

    // Kept on a document the pane has left: the mark and the passage's onKept belong to
    // the old one, so they are skipped. The line is still sent.
    if (!moved()) {
      markedRef.current(id);
      taking.onKept?.(id);
    }
    // The same answers `capture` gives, in the take's words.
    const { waiting, failure } = await flushOutbox();
    if (moved()) return true;
    const mine = waiting.find((each) => each.id === dump.id);
    if (mine === undefined) {
      // The daily note is read over the network, so the pane may move on while it is.
      const undo = await undoFor(daily, quote, id);
      if (moved()) return true;
      show("Taken into today's dump", taking, undo);
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
        archive={archive}
        onUndo={undo === undefined ? undefined : () => void undoTake(undo)}
        onPut={(notePath) => putInto(toast.id, notePath, toast)}
        onDone={forget}
      />
    );

  return { take, forget, toast: element };
}
