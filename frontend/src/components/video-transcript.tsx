import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { TakeButton } from "@/components/take-button-view";
import { useBookNoteTake } from "@/components/use-book-note-take";
import type { Passage } from "@/lib/highlight";
import { type Anchor, low, placeFor } from "@/lib/page-selection";
import { VIDEO_REFUSED } from "@/lib/page-undo";
import { usePressGuard } from "@/lib/take-button";
import { timestamp } from "@/lib/transcript";
import { useViewport } from "@/lib/use-viewport";
import { currentAt, timeLink, transcriptParagraphs } from "@/lib/video-notes";

/** The time at the start of a paragraph, the way the note writes it, bar the brackets. */
export function clockOf(seconds: number): string {
  return timestamp(seconds).slice(1, -1);
}

/**
 * A time as a button. Shared with the takes list, so a time looks the same in both.
 *
 * `select-none` keeps the time out of a selection, so a take of the words does
 * not carry it in as text.
 */
export const CLOCK =
  "select-none font-mono text-k-12 text-k-link hover:text-k-accent tabular-nums mr-2 relative pointer-coarse:min-h-0 before:absolute before:-inset-y-3 before:inset-x-0 before:content-['']";

/** The take's one handle: the pane's `y` takes the held selection through it. */
export interface TranscriptHandle {
  /** Take the held selection; false when none is held. */
  take(): boolean;
}

/** The selection held for a take: its words, the paragraph its start is in, and where its button goes. */
interface Held {
  text: string;
  seconds: number;
  at: Anchor | null;
}

/** The reduced-motion query, asked on each scroll so a change of setting is seen at once. */
const REDUCED = "(prefers-reduced-motion: reduce)";

export function VideoTranscript({
  note,
  id,
  text,
  second,
  archive,
  onTake,
  onSeek,
  handle,
}: {
  /** The note's path, which the take writes into. */
  note: string;
  /** The video's id, which the take's time link names. */
  id: string;
  /** The note's text, which holds the transcript. */
  text: string;
  /** The player's place, in seconds. */
  second: number;
  archive: boolean;
  onTake: (passage: Passage) => Promise<string | null>;
  onSeek: (seconds: number) => void;
  handle: RefObject<TranscriptHandle | null>;
}) {
  const paragraphs = useMemo(() => transcriptParagraphs(text), [text]);
  const current = currentAt(paragraphs, second);
  const [follow, setFollow] = useState(true);

  const list = useRef<HTMLOListElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);

  // A touch screen's button goes under the words. Read by the selection's
  // listener, which is added once, so it is mirrored in a layout effect.
  const { coarse } = useViewport();
  const coarseRef = useRef(coarse);
  useLayoutEffect(() => {
    coarseRef.current = coarse;
  });

  // The held selection, mirrored in a ref so a `y` answered a render late still
  // takes the one held now, not the one before.
  const [held, setHeld] = useState<Held | null>(null);
  const heldRef = useRef<Held | null>(null);
  const hold = useCallback((next: Held | null) => {
    heldRef.current = next;
    setHeld(next);
  }, []);

  /** A collapse during a press on the button, which the press guard holds back. */
  const lost = useRef(false);
  const { pressing, press } = usePressGuard(() => {
    if (lost.current) {
      lost.current = false;
      hold(null);
    }
  });

  const bookTake = useBookNoteTake({
    note,
    archive,
    onTake,
    title: "Taken into the video's note",
    refused: VIDEO_REFUSED,
  });

  /** A selection that is not one in the transcript: kept through a press, dropped otherwise. */
  function dropHeld() {
    if (pressing.current) lost.current = true;
    else hold(null);
  }

  function readSelection() {
    const box = list.current;
    const selection = document.getSelection();
    const range = selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    // Both ends in the list, so a selection that starts in the transcript and
    // runs out of it is no take, and nor is one that starts outside.
    if (
      box === null ||
      selection === null ||
      range === null ||
      selection.isCollapsed ||
      !box.contains(selection.anchorNode) ||
      !box.contains(selection.focusNode)
    ) {
      dropHeld();
      return;
    }

    // The paragraph the range starts in. A selection made backwards starts at its
    // other end, so the earlier paragraph's time is the one taken (I8).
    const start =
      range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement;
    const li = start?.closest<HTMLElement>("li[data-at]");
    if (li === undefined || li === null) {
      dropHeld();
      return;
    }

    lost.current = false;
    const pane = wrapper.current;
    const rect = range.getBoundingClientRect();
    const frame = box.getBoundingClientRect();
    const at =
      pane === null
        ? null
        : placeFor(
            box,
            pane,
            {
              left: rect.left - frame.left,
              top: rect.top - frame.top,
              right: rect.right - frame.left,
              bottom: rect.bottom - frame.top,
            },
            coarseRef.current,
          );
    hold({ text: selection.toString(), seconds: Number(li.dataset.at), at });
  }

  // The listener is added once, so it reaches `readSelection` as it is now through this.
  const reading = useRef(readSelection);
  useLayoutEffect(() => {
    reading.current = readSelection;
  });
  useEffect(() => {
    const onChange = () => reading.current();
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, []);

  /** Takes the held selection; false when none is held. Read by the pane's `y` through `handle`. */
  function takeHeld(): boolean {
    pressing.current = false;
    lost.current = false;
    const taken = heldRef.current;
    if (taken === null) return false;
    hold(null);
    // Taken, so the words are no longer a selection the reader is making.
    document.getSelection()?.removeAllRanges();
    void bookTake.take(
      {
        text: taken.text,
        // The route strips `chapter` before the write, so the anchor line is the link alone.
        chapter: `at ${clockOf(taken.seconds)}`,
        link: timeLink(id, taken.seconds),
      },
      low(taken.at),
    );
    return true;
  }

  useLayoutEffect(() => {
    handle.current = { take: takeHeld };
  });

  // Follows the video: the current paragraph is scrolled to a third from the top
  // of the list, and only the list moves, never the page.
  useEffect(() => {
    const box = list.current;
    const li = current < 0 ? undefined : box?.children[current];
    if (!follow || box === null || !(li instanceof HTMLElement)) return;
    // Measured from the rectangles and not `offsetTop`, which counts from the
    // wrapper, the header above the list among it.
    const top =
      box.scrollTop +
      li.getBoundingClientRect().top -
      box.getBoundingClientRect().top -
      box.clientHeight / 3;
    const behavior = window.matchMedia(REDUCED).matches ? "auto" : "smooth";
    // jsdom has no `scrollTo`, and a browser that lacks it still scrolls by `scrollTop`.
    if (typeof box.scrollTo === "function") box.scrollTo({ top, behavior });
    else box.scrollTop = top;
  }, [current, follow]);

  return (
    <div ref={wrapper} className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 px-3 py-2">
        <span className="text-k-12 uppercase text-k-muted">TRANSCRIPT</span>
        <button
          type="button"
          aria-pressed={follow}
          // Refused so the press leaves the focus on the pane, where its keys are.
          onPointerDown={(event: ReactPointerEvent) => event.preventDefault()}
          onClick={() => setFollow(!follow)}
          className={`ml-auto font-sans text-k-12 pointer-coarse:min-h-11 ${follow ? "text-k-accent" : "text-k-muted"}`}
        >
          Follows the video
        </button>
      </div>

      {paragraphs.length === 0 ? (
        <p className="px-3 font-sans text-k-13 text-k-muted">
          No transcript in this note yet. <kbd className="font-mono">Space c v</kbd> writes it under
          ## Transcript.
        </p>
      ) : (
        <ol
          aria-label="Transcript"
          ref={list}
          onPointerUp={() => reading.current()}
          className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 selection:bg-k-highlight selection:text-k-ink"
        >
          {paragraphs.map((paragraph, index) => {
            const marked = index === current;
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: the transcript is read-only and never reorders, and a hand edit can repeat a second, so the place in the list is the identity.
              <li key={`${index}:${paragraph.seconds}`} data-at={paragraph.seconds}>
                <p
                  aria-current={marked ? "true" : undefined}
                  className={`-mx-2 font-serif text-k-15 leading-(--k-leading-reading) text-k-ink rounded-[var(--k-radius-4)] px-2 py-1${marked ? " bg-k-accent-wash" : ""}`}
                >
                  <button
                    type="button"
                    aria-label={`Seek to ${clockOf(paragraph.seconds)}`}
                    onClick={() => onSeek(paragraph.seconds)}
                    className={CLOCK}
                  >
                    {clockOf(paragraph.seconds)}
                  </button>
                  {paragraph.text}
                </p>
              </li>
            );
          })}
        </ol>
      )}

      {held?.at && (
        <TakeButton
          at={held.at}
          label={`at ${clockOf(held.seconds)}`}
          press={press}
          onTake={() => void takeHeld()}
        />
      )}
      {bookTake.toast}
    </div>
  );
}
