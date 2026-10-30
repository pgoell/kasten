import { type RefObject, useCallback, useLayoutEffect, useRef, useState } from "react";
import { uploadAsset } from "@/lib/api";
import type { Passage } from "@/lib/highlight";
import { filedName, IMAGE_FOLDER } from "@/lib/image";
import { clampInside, type PressHandlers, usePressGuard } from "@/lib/take-button";

/**
 * Whether the selection runs backwards, as foliate reads it. A `Range` is always
 * in document order, so nothing later can tell which end the drag finished at.
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
 * foliate makes resource URLs `blob:` in the main frame, so `fetch` reads the file
 * the epub shipped, bytes and media type both. `cloneContents` keeps the figure to
 * the selection, so one outside it cannot come along.
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
   * What is selected in the book now, or null. A ref because `onKeyDown` has no
   * dependencies, so a `y` branch reading state would see the mount value forever.
   * The passage is decided once, when selected, since its truth can change a second later.
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

  // Read through refs, so these callbacks keep one identity. A layout effect keeps them
  // current before the passive effects, so a call made in between sees the new prop.
  const onTakeRef = useRef(onTake);
  const onNoticeRef = useRef(onNotice);
  useLayoutEffect(() => {
    onTakeRef.current = onTake;
    onNoticeRef.current = onNotice;
  });

  /**
   * Report what is selected and put the selection away. The button and `y` share
   * this path, so there is one answer. The document comes off the range, not a
   * fourth field on the ref.
   */
  const take = useCallback(async () => {
    pressing.current = false;
    const held = taking.current;
    if (held === null) return;
    taking.current = null;
    setAt(null);
    held.range.startContainer.ownerDocument?.getSelection()?.removeAllRanges();

    // A figure goes in the vault before the passage is reported, so a refused upload
    // leaves the note as it was. A take carrying a picture is refused whole, and says why.
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
        // Typed `unknown`, as the paste catches: a dropped connection rejects with no status.
        // An `.svg` plate an epub holds is refused here, not sorted out above.
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
    // Another section is on the page, so a held range points into a document that
    // left the tree. The chapter travels with the passage, so only the range matters.
    if (taking.current?.range.startContainer.ownerDocument !== doc) taking.current = null;
  }, []);

  /**
   * Where the button goes for a selection, or null where the iframe is out of reach
   * (jsdom). Measured at the end the drag finished at: `getClientRects` is in
   * document order, so that is the last rect forwards and the first backwards.
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
      // `toString()` on the selection, never the range: a range runs two paragraphs
      // together, while a selection keeps the break the format rests on.
      const text = selection === null ? "" : selection.toString();
      const range =
        selection === null || selection.rangeCount === 0 ? null : selection.getRangeAt(0);
      const figure = range === null ? null : figureIn(range);
      // A figure is a passage with no words, so the text alone cannot say nothing is selected.
      if (selection === null || range === null || (text.trim() === "" && figure === null)) {
        // The press on `Take` cleared the selection, so the passage is still being taken.
        if (pressing.current) return;
        taking.current = null;
        setAt(null);
        return;
      }

      // The chapter is set on the first change of a selection and kept: a drag across
      // a chapter boundary would be named for where it came to rest. A new selection ends any press.
      pressing.current = false;
      const chapter = taking.current?.passage.chapter ?? chapterOf();
      const backward = runsBackward(doc, selection);
      taking.current = { passage: { text, chapter }, figure, range, backward };
      setAt(place(range, backward));
    },
    [place, pressing],
  );

  const follow = useCallback(() => {
    // The button follows the words: foliate turns the page up to 700ms after a drag past
    // the edge (`checkPointerSelection`), so the button would point at words that have left.
    // Read off the ref, since this closure is built once with the view.
    const held = taking.current;
    setAt(held === null ? null : place(held.range, held.backward));
  }, [place]);

  return { at, take, holding, forgetUnless, select, follow, press };
}
