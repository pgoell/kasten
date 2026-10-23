import { type RefObject, useCallback, useLayoutEffect, useRef, useState } from "react";
import { uploadAsset } from "@/lib/api";
import type { Passage } from "@/lib/highlight";
import { filedName, IMAGE_FOLDER } from "@/lib/image";
import { clampInside, type PressHandlers, usePressGuard } from "@/lib/take-button";

/**
 * Whether the selection runs backwards, which says which end the hand is at.
 *
 * The way foliate reads it (`selectionIsBackward`, `paginator.js:153-158`): a
 * range built from the anchor to the focus collapses when the focus lies before
 * the anchor. A `Range` is always in document order, so nothing later can
 * recover which end a drag finished at.
 */
function runsBackward(doc: Document, selection: Selection): boolean {
  const { anchorNode, focusNode } = selection;
  if (anchorNode === null || focusNode === null) return false;
  const probe = doc.createRange();
  probe.setStart(anchorNode, selection.anchorOffset);
  probe.setEnd(focusNode, selection.focusOffset);
  return probe.collapsed;
}

/**
 * The figure a selection holds, as the URL the book carries it at, or null.
 *
 * foliate rewrites every resource in a section to a `blob:` URL and makes those
 * in the main frame (`epub.js:727`), so this reads out of the same origin the
 * pane runs in and `fetch` below answers with the file the epub shipped, bytes
 * and media type both. A canvas would answer with a re-encode of whatever fits
 * on the page.
 *
 * `cloneContents` rather than a walk over `commonAncestorContainer`: the clone
 * is the selection and nothing else, so a figure two paragraphs down the page
 * cannot come along with a run of text that never touched it.
 */
function figureIn(range: Range): string | null {
  return range.cloneContents().querySelector("img")?.src ?? null;
}

/** What the take hook hands the pane: the button's place, and the calls it makes. */
export interface BookTake {
  /** Where to draw the button, or null to draw none. */
  at: { x: number; y: number } | null;
  /** Take what is held, or nothing when nothing is. */
  take: () => Promise<void>;
  /** Whether a passage is held, which the edges of the page ask before they turn. */
  holding: () => boolean;
  /** Forget the held passage when a document other than its own has loaded. */
  forgetUnless: (doc: Document) => void;
  /** Read what is selected in `doc`, with the chapter it is in (read only when no passage is held yet). */
  select: (doc: Document, chapterOf: () => string) => void;
  /** Move the button to where the held words are now. */
  follow: () => void;
  /** The footer's `Take` button, which finds its own press and lift in these. */
  press: PressHandlers;
}

/**
 * The passage a reader takes out of the book, from the selection to the note.
 *
 * Owns the held selection, the button's place and the press on the footer's
 * `Take`. The pane owns the button itself.
 */
export function useBookTake(o: {
  wrapper: RefObject<HTMLDivElement | null>;
  onTake: (passage: Passage) => void;
  onNotice: (message: string) => void;
}): BookTake {
  const { wrapper, onTake, onNotice } = o;
  /** Where to draw the button, or null to draw none. The only part of this that renders. */
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  /**
   * What is selected in the book now, or null for nothing.
   *
   * A ref for the same reason `contentsOpen` is one, and the argument is worth
   * the lines because both wrong answers look right: `onKeyDown` is a
   * `useCallback` with no dependencies, so a `y` branch closing over a piece of
   * state would read the mount value, which is nothing, for the life of the
   * pane, and naming that state in the callback's dependencies would rebuild
   * the reader on every drag.
   *
   * The whole passage is decided here, at the moment the selection is made,
   * and never asked about again: everything true of a passage is true when you
   * select it and may not be a second later.
   */
  const taking = useRef<{
    passage: Passage;
    /** The book's own URL for the figure the selection holds, null where it holds none. */
    figure: string | null;
    range: Range;
    backward: boolean;
  } | null>(null);
  /**
   * The press on the footer's `Take`, which holds the passage through the
   * collapse a tap outside the frame causes. The book's words live in foliate's
   * iframe and the button does not, so the `selectionchange` that collapse sends
   * arrives before the `click`; the guard answers it once the press is over.
   */
  const { pressing, press } = usePressGuard(() =>
    taking.current?.range.startContainer.ownerDocument?.dispatchEvent(new Event("selectionchange")),
  );

  // Read through refs, so the callbacks below keep one identity for the life of
  // the pane, the way `terminal-pane.tsx` reads the same props. Written in a
  // layout effect, which runs in the commit's own task, so a call made between
  // the commit and the passive effects sees the new prop.
  const onTakeRef = useRef(onTake);
  const onNoticeRef = useRef(onNotice);
  useLayoutEffect(() => {
    onTakeRef.current = onTake;
    onNoticeRef.current = onNotice;
  });

  /**
   * Report what is selected and put the selection away.
   *
   * One path for the button and for `y`, so there is one answer to what is
   * selected. It asks foliate nothing: the passage was decided when the
   * selection was made. Clearing the selection is the only signal the pane
   * gives that the press landed, and the document to clear it in comes off the
   * range rather than out of a fourth field on the ref.
   */
  const take = useCallback(async () => {
    pressing.current = false;
    const held = taking.current;
    if (held === null) return;
    taking.current = null;
    setAt(null);
    held.range.startContainer.ownerDocument?.getSelection()?.removeAllRanges();

    // A figure goes in the vault before the passage is reported, the rule the
    // paste in `image.ts` settled: a refused upload leaves the note as it was
    // rather than holding a reference to nothing. So a take carrying a picture
    // is refused whole, caption included, and says why.
    let image: string | undefined;
    if (held.figure !== null) {
      const blob = await fetch(held.figure).then(
        (answer) => answer.blob(),
        () => null,
      );
      if (blob === null) {
        onNoticeRef.current("The figure could not be read out of the book");
        return;
      }

      const path = `${IMAGE_FOLDER}/${filedName(blob.type)}`;
      const landed = await uploadAsset(path, blob).then(
        () => true,
        // A typed `unknown` and not an untyped catch, the way the paste catches:
        // a `fetch` rejects with no response at all on a dropped connection, and
        // there is no status to name. An epub figure the vault holds no magic
        // for, an `.svg` plate, is refused here rather than sorted out above.
        (error: unknown) => {
          onNoticeRef.current(error instanceof Error ? error.message : "The figure did not go in");
          return false;
        },
      );
      if (!landed) return;
      image = path;
    }

    onTakeRef.current({ ...held.passage, image });
  }, [pressing]);

  const holding = useCallback(() => taking.current !== null, []);

  const forgetUnless = useCallback((doc: Document) => {
    // Another section is on the page, so a held range points into a document
    // that has been removed from the tree (`paginator.js:666-676`). The
    // chapter travels with the passage, so this is no longer about the
    // label; it is about the range.
    if (taking.current?.range.startContainer.ownerDocument !== doc) taking.current = null;
  }, []);

  /**
   * Where the button goes for a selection, or null where the iframe is out
   * of reach, which is jsdom and nothing else.
   *
   * The rectangle at the end the drag finished at: `getClientRects` answers
   * in document order, so that is the last one running forwards and the
   * first one running backwards, and the button belongs at the end the hand
   * is at.
   */
  const place = useCallback(
    (range: Range, backward: boolean): { x: number; y: number } | null => {
      const frame = range.startContainer.ownerDocument?.defaultView?.frameElement;
      const pane = wrapper.current;
      if (!frame || pane === null) return null;

      const rects = range.getClientRects();
      const rect = backward ? rects[0] : rects[rects.length - 1];
      if (rect === undefined) return null;

      const outer = frame.getBoundingClientRect();
      const box = pane.getBoundingClientRect();
      const x = outer.left + rect.left + rect.width / 2 - box.left;
      const y = outer.top + rect.top - box.top;
      return clampInside(x, y, box);
    },
    [wrapper],
  );

  const select = useCallback(
    (doc: Document, chapterOf: () => string) => {
      const selection = doc.getSelection();
      // `selection.toString()` and never `range.toString()`: measured in
      // Chromium, a range runs two paragraphs together where a selection keeps
      // the break, and that break is what the whole format rests on.
      const text = selection === null ? "" : selection.toString();
      const range =
        selection === null || selection.rangeCount === 0 ? null : selection.getRangeAt(0);
      const figure = range === null ? null : figureIn(range);
      // A figure is a passage with no words in it: a drag over a plate gives an
      // empty string, so the text alone cannot say whether anything is selected.
      if (selection === null || range === null || (text.trim() === "" && figure === null)) {
        // The press on `Take` is what put the selection away, so the passage
        // is still the one being taken. See `pressing`.
        if (pressing.current) return;
        taking.current = null;
        setAt(null);
        return;
      }

      // The chapter is written on the first change of a selection and kept.
      // A chapter can change with no document loading, one spine file often
      // holding several, so a drag that runs past a boundary would otherwise
      // be named for wherever it came to rest.
      // Something new is selected, so a press that never ended is over.
      pressing.current = false;
      const chapter = taking.current?.passage.chapter ?? chapterOf();
      const backward = runsBackward(doc, selection);
      taking.current = { passage: { text, chapter }, figure, range, backward };
      setAt(place(range, backward));
    },
    [place, pressing],
  );

  const follow = useCallback(() => {
    // The button follows the words. foliate turns the page up to 700ms after
    // you let go of a selection that ran past the edge
    // (`checkPointerSelection`, `paginator.js:586-594`), so without this the
    // button would go on pointing at a place the words have left. Off the
    // ref, which is the other reason the ref exists: this closure is built
    // once with the view and would otherwise read the selection the pane had
    // when the book opened, which is nothing.
    const held = taking.current;
    setAt(held === null ? null : place(held.range, held.backward));
  }, [place]);

  return { at, take, holding, forgetUnless, select, follow, press };
}
