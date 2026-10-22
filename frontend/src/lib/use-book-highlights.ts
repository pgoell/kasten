import { useQuery } from "@tanstack/react-query";
// The drawing half of the same seam: `Overlayer.highlight` is the function that
// paints a range, handed to the overlay rather than called here.
import { Overlayer } from "foliate-js/overlayer.js";
import { type RefObject, useCallback, useEffect, useMemo, useRef } from "react";
import { fetchNote } from "@/lib/api";
import { findQuotes } from "@/lib/find-quote";
import { type FoliateOverlayer, type FoliateView, pdfLayer } from "@/lib/foliate-view";
import { type HighlightBlock, highlightBlocks } from "@/lib/highlight";

/**
 * Throw away every text layer on a pdf page but the newest.
 *
 * foliate re-renders a page whenever its own box changes, observing it
 * (`fixed-layout.js:60, :136`), and pdf.js's `TextLayer` **appends** to the
 * container it was handed rather than replacing what is in it. So a resize
 * leaves the page holding its words twice over. Measured in Chromium: two spans
 * become four and the page's text reads twice. Left alone that is a page whose
 * words are doubled to a selection and to `findQuotes`, and `indexOf` takes the
 * first of the two, so every highlight anchors to the copy the words have
 * already left.
 *
 * The marker is the `endOfContent` div foliate appends after each render
 * finishes (`pdf.js:53-56`), which makes it exactly one per completed render
 * and in the order they completed. So everything up to and including the
 * second to last one belongs to a render that has been superseded. The canvas
 * looked like a cheaper marker, being replaced at the top of that same
 * function, and it is not: two renders overlap when a resize lands inside one,
 * both replace the canvas before either appends its text, and clearing on the
 * canvas would then throw away nothing at all.
 *
 * ponytail: the newest generation is the last to finish and not necessarily the
 * last to start, so two resizes close enough together for the earlier render to
 * land second leave the page holding text laid out for a box it has left. The
 * next resize corrects it and nothing is lost. foliate hands out no render id
 * to sort by, so the fix is a queue of our own around a library call we do not
 * make, which is worth more than the case costs.
 *
 * An overlay hung on the page is taken out with whatever generation it happens
 * to sit inside, which is not every prune: hung after the newest marker, it
 * survives the next one and is swept by the one after. Neither outcome needs
 * handling, because the draw pass hangs another whenever `element.isConnected`
 * says the last one has gone, and aims it at the page every pass either way.
 */
function pruneLayer(layer: HTMLElement): void {
  const ends = layer.querySelectorAll(":scope > .endOfContent");
  const boundary = ends[ends.length - 2];
  if (boundary === undefined) return;

  while (layer.firstChild !== null && layer.firstChild !== boundary) layer.firstChild.remove();
  boundary.remove();
}

/**
 * Hang an overlay on a pdf page, which is the one thing foliate does not.
 *
 * `fixed-layout.js:308-313` answers `{ doc }` and says `// TODO: index,
 * overlayer` where the paginator builds one and emits `create-overlay`. The
 * class itself is standalone, so the pane makes one and hangs it where the
 * paginator would have.
 *
 * Two things about where it goes. It goes **inside the text layer**, which is
 * `position: absolute; inset: 0` over the page, so its box is the page's own
 * and the rects a range answers with need no offset. And it is scaled by the
 * inverse of the root transform, which is the part that is invisible on the
 * machine this was written on: `pdf.js:17-19` lays the page out at
 * `zoom * devicePixelRatio` and scales `<html>` back down by `1 / dpr`, so on a
 * retina screen one layout pixel is half a client pixel while `getClientRects`
 * answers in client pixels. Read off the computed transform rather than off
 * `devicePixelRatio`, because what has to be undone is whatever foliate did.
 */
function hangOverlay(layer: HTMLElement): FoliateOverlayer {
  const overlayer = new Overlayer() as unknown as FoliateOverlayer;
  overlayer.element.style.transformOrigin = "top left";
  layer.append(overlayer.element);
  return overlayer;
}

/**
 * Point an overlay at the page's coordinates, whatever pdf.js has scaled it to.
 *
 * Set on every pass and not once when the overlay is hung, because the scale is
 * not fixed for the life of a page: `render` recomputes it from the zoom on
 * every resize (`pdf.js:16`) and the overlay outlives that, so a highlight hung
 * before a zoom would go on undoing a scale the page no longer has.
 */
function aimOverlay(overlayer: FoliateOverlayer, doc: Document): void {
  overlayer.element.style.transform = `scale(${1 / pageScale(doc)})`;
}

/**
 * What pdf.js scaled this page's document by, or 1 where it has not yet.
 *
 * `getComputedStyle` answers the string `none` for an element carrying no
 * transform, which `DOMMatrixReadOnly` throws a `SyntaxError` over rather than
 * reading as the identity. That is not a hypothetical: the layer exists in the
 * shell document from the moment the iframe loads and `render` sets the
 * transform a good while later, so a draw pass landing in that window would
 * throw out of the overlay and take the highlights on the facing page with it.
 * A zero scale is guarded for the same reason, dividing by it putting the
 * overlay at infinity rather than merely in the wrong place.
 */
function pageScale(doc: Document): number {
  const transform = getComputedStyle(doc.documentElement).transform;
  if (transform === "none" || transform === "") return 1;

  const { a } = new DOMMatrixReadOnly(transform);
  return a === 0 ? 1 : a;
}

/** What the view hook asks of the highlights: a redraw, and the watch on each pdf page. */
export interface BookHighlights {
  /** Draw every highlight again on what is on screen. */
  repaint: () => void;
  /** Watch a pdf page's text layer, answering the observer to disconnect when the page leaves. */
  watchPage: (doc: Document, view: FoliateView) => MutationObserver | undefined;
}

/**
 * Every highlight the note holds, drawn on the pages the book shows.
 *
 * Owns the overlays, what was drawn last time, and the note's highlights. The
 * view hook says when a page is on screen and asks for a repaint.
 */
export function useBookHighlights(
  note: string,
  viewRef: RefObject<FoliateView | null>,
): BookHighlights {
  // The same key the editor beside it writes and the events stream
  // invalidates, so a highlight deleted by hand and saved stops being drawn
  // with no word between the panes. The `reading:` field is still read a
  // second time inside `draw()`: that is PR 2's tested path, and one small
  // `GET` does not buy either putting the note's text in the view effect's
  // dependencies or routing that read through the query client.
  const { data: text } = useQuery({ queryKey: ["note", note], queryFn: () => fetchNote(note) });

  /** Every highlight the note holds, and a stable identity for the effect below. */
  const blocks = useMemo(() => highlightBlocks(text ?? ""), [text]);
  // Read off a ref by the `create-overlay` listener, which is built with the
  // view and cannot name a value that changes without tearing the book down.
  const blocksRef = useRef(blocks);
  /**
   * What the last pass drew, so the next one can take it off first.
   *
   * The overlay travels with the id because a spread has two of them and an id
   * removed from the wrong one does nothing at all (`overlayer.js:26`), which
   * would leave the old highlight painted over the new.
   */
  const drawn = useRef<{ overlayer: FoliateOverlayer; id: string }[]>([]);
  /**
   * The overlay each pdf page carries, which foliate builds for no page.
   *
   * Weak and keyed on the document, so a page that has scrolled off takes its
   * overlay with it: `#showSpread` calls `replaceChildren` on its root
   * (`fixed-layout.js:167`), so every turn builds new frames and new documents.
   */
  const overlays = useRef(new WeakMap<Document, FoliateOverlayer>());

  /**
   * Draw `blocks` on what is on screen, in one walk of each document.
   *
   * A flowing book shows one section and a pdf shows a spread, so this walks
   * the list. An entry with neither an overlayer nor a text layer is nothing to
   * draw on: a book still opening, a blank half of a spread, or a
   * pre-paginated epub, which foliate renders through the same renderer as a
   * pdf and gives no way in to.
   */
  const redraw = useCallback(
    (blocks: HighlightBlock[]) => {
      /** The overlay a pdf page carries, hung on first use and after a re-render. */
      function pdfOverlay(doc: Document): FoliateOverlayer | undefined {
        const layer = pdfLayer(doc);
        if (layer === null) return undefined;

        // A re-render takes the old overlay out with the stale text layer, so an
        // element that has left the tree is what says to hang another.
        const held = overlays.current.get(doc);
        if (held?.element.isConnected) return held;

        const made = hangOverlay(layer);
        overlays.current.set(doc, made);
        return made;
      }

      const shown = viewRef.current?.renderer?.getContents?.() ?? [];

      // Removing an id from an overlay that never held it does nothing
      // (`overlayer.js:26`), so a fresh section needs no bookkeeping beyond this.
      for (const { overlayer, id } of drawn.current) overlayer.remove(id);
      drawn.current = [];

      // Read the way `pageStyles` reads the palette, so the book, the app and the
      // highlight stay one set of colours in `kasten-theme.css`.
      const colour = getComputedStyle(document.documentElement)
        .getPropertyValue("--k-accent")
        .trim();

      for (const entry of shown) {
        const overlayer = entry.overlayer ?? pdfOverlay(entry.doc);
        if (overlayer === undefined) continue;
        // foliate's own overlay is aimed by the paginator; only a hung one is
        // this pane's to point at the page.
        if (overlayer !== entry.overlayer) aimOverlay(overlayer, entry.doc);

        const found = findQuotes(
          entry.doc,
          blocks.map((block) => block.quote),
        );
        for (const [at, range] of found.entries()) {
          const block = blocks[at];
          // A quote the book no longer holds is skipped in silence. A pass nobody
          // asked for gets no answer, which is where drawing and `gf` differ.
          if (range === null || block === undefined) continue;
          overlayer.add(block.id, range, Overlayer.highlight, { color: colour });
          drawn.current.push({ overlayer, id: block.id });
        }
      }
    },
    [viewRef],
  );

  // The second trigger, and neither covers the other: the first section's
  // overlay is often built before the note query has answered, and a page into
  // a new chapter is the other way round with the blocks not having moved.
  useEffect(() => {
    blocksRef.current = blocks;
    redraw(blocks);
  }, [blocks, redraw]);

  const repaint = useCallback(() => redraw(blocksRef.current), [redraw]);

  /**
   * Watch a pdf page's text layer, which is the only word anyone gets that it
   * is drawable.
   *
   * A page arrives empty and fills later: `#createFrame` emits `load` when the
   * iframe's shell document loads, and `render` (`pdf.js:14-78`) paints the
   * canvas and builds the text layer from `#render`, which nothing awaits
   * (`fixed-layout.js:136`). There is no event for the end of that, so the
   * layer's own children are the signal, for the first render and for every
   * one after it.
   */
  const watchPage = useCallback(
    (doc: Document, view: FoliateView): MutationObserver | undefined => {
      const layer = pdfLayer(doc);
      if (layer === null) return;

      const filled = new MutationObserver(() => {
        if (viewRef.current !== view) return;
        pruneLayer(layer);
        redraw(blocksRef.current);
      });
      filled.observe(layer, { childList: true });
      return filled;
    },
    [redraw, viewRef],
  );

  return { repaint, watchPage };
}
