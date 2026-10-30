import { type ReactNode, useLayoutEffect, useRef } from "react";
import { type ToastTaking, useTakeToast } from "@/components/use-take-toast";
import { readClock } from "@/lib/clock";
import { quoteBlock } from "@/lib/html-take";
// Renamed for the reason `use-prompts.tsx` renames it: the take is a dump, and
// the page has no other `flush` to confuse it with.
import { flush as flushOutbox, keep } from "@/lib/outbox";
import { REFUSED, undoFor } from "@/lib/page-undo";
import { periodicNote } from "@/lib/periodic";

/** A passage held for a take, as the pane names it: the dump's text and where it came from. */
export interface Taking extends ToastTaking {
  /** Called with this take's id once it is kept, for what this take alone holds. */
  onKept?: (id: number) => void;
  /** The toast's line once the take has landed. "Taken into today's dump" when left out. */
  landed?: string;
}

/**
 * The one dump write path for a take out of a vault page. `onMarked` fires once the words are
 * safe on the device, the only point the selection may be called taken. `onUnmarked` fires when
 * Undo takes the dump line back out.
 */
export function useDumpTake(o: {
  archive: boolean;
  onMarked: (id: number) => void;
  onUnmarked: (id: number) => void;
}): {
  /**
   * Keep the take on the device, mark it, send it and toast. Returns true after a failed keep too,
   * so the pane does not hold the old passage over a new document; false when it was not kept.
   */
  take(taking: Taking): Promise<boolean>;
  /** Drop the toast (a new document in the pane). */
  forget(): void;
  /** The toast, or null; the pane renders it inside its wrapper. */
  toast: ReactNode;
} {
  const { archive, onMarked, onUnmarked } = o;
  const toast = useTakeToast({ archive, refused: REFUSED, onUnmarked });
  // The take's mark, counted per pane so each take has its own id.
  const marks = useRef(0);
  // Read through a ref, so a pane's new callback is the one called. Written in
  // a layout effect, the way the panes write theirs.
  const markedRef = useRef(onMarked);
  useLayoutEffect(() => {
    markedRef.current = onMarked;
  });

  async function take(taking: Taking): Promise<boolean> {
    const now = new Date();
    const daily = periodicNote("daily", now).path;
    const quote = taking.line?.(daily) ?? quoteBlock(taking.text, taking.linkIn(daily));
    marks.current += 1;
    const id = marks.current;
    // Read before the first await, so a forget() during the keep or the send shows.
    const started = toast.generation();
    const moved = () => toast.moved(started);

    const dump = await keep(quote, readClock(now).date).then(
      (kept) => kept,
      (error: unknown) => {
        toast.show(error instanceof Error ? error.message : "The take was not kept", taking);
        return null;
      },
    );
    // The error is shown even over a new document, since the words are saved nowhere else.
    if (dump === null) return moved();

    // Kept on a document the pane has left: the mark and the passage's onKept belong to
    // the old one, so they are skipped. The line is still sent.
    // A line of its own is no selection, so there is nothing on the page to mark.
    if (!moved()) {
      if (taking.line === undefined) markedRef.current(id);
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
      toast.show(taking.landed ?? "Taken into today's dump", taking, undo);
    } else if (mine.refused !== undefined) {
      toast.show(mine.refused, taking);
    } else if (failure?.kind === "sign-in") {
      toast.show("Taken, waiting to send: sign in again", taking);
    } else {
      toast.show(`Taken, waiting to send (${waiting.length} waiting)`, taking);
    }
    return true;
  }

  return { take, forget: toast.forget, toast: toast.toast };
}
