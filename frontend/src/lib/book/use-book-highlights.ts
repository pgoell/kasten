import { useQuery } from "@tanstack/react-query";
// Drawing half of the seam: `Overlayer.highlight` paints a range, handed to the overlay.
import { Overlayer } from "foliate-js/overlayer.js";
import { type RefObject, useCallback, useEffect, useMemo, useRef } from "react";
import { fetchNote } from "@/lib/api";
import { findWritten } from "@/lib/book/find-quote";
import { type FoliateOverlayer, type FoliateView, pdfLayer } from "@/lib/book/foliate-view";
import { type HighlightBlock, highlightBlocks } from "@/lib/highlight";
import { onThemeChange } from "@/lib/theme";

/**
 * Throw away every pdf text layer but the newest, marked by foliate's `endOfContent`. pdf.js appends
 * on each resize and `findQuotes` takes the first copy. Out-of-order renders can leave stale text until the next resize.
 */
function pruneLayer(layer: HTMLElement): void {
  const ends = layer.querySelectorAll(":scope > .endOfContent");
  const boundary = ends[ends.length - 2];
  if (boundary === undefined) return;

  while (layer.firstChild !== null && layer.firstChild !== boundary) layer.firstChild.remove();
  boundary.remove();
}

/**
 * Hang an overlay on a pdf page, which foliate builds for flowing books only. It sits inside the text
 * layer so its box is the page's own. `aimOverlay` sets its scale, since pdf.js scales by `1 / devicePixelRatio`.
 */
function hangOverlay(layer: HTMLElement): FoliateOverlayer {
  const overlayer = new Overlayer() as unknown as FoliateOverlayer;
  overlayer.element.style.transformOrigin = "top left";
  // The view sets this for a flowing book; the page is its own document, so it does not reach here.
  overlayer.element.style.setProperty("--overlayer-highlight-opacity", "1");
  layer.append(overlayer.element);
  return overlayer;
}

/**
 * Set on every pass, not once when hung: pdf.js recomputes the scale on each
 * resize, so an overlay hung before a zoom would keep undoing a stale scale.
 */
function aimOverlay(overlayer: FoliateOverlayer, doc: Document): void {
  overlayer.element.style.transform = `scale(${1 / pageScale(doc)})`;
}

/**
 * What pdf.js scaled this page's document by, or 1 before it has. `getComputedStyle` answers `none`
 * with no transform, which `DOMMatrixReadOnly` throws on. A zero scale is guarded: it would put the overlay at infinity.
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
  /** Every highlight the note holds, in the order it holds them, for the note column. */
  blocks: HighlightBlock[];
}

/**
 * Every highlight the note holds, drawn on the pages the book shows. The view hook says when a page
 * is on screen and asks for a repaint.
 */
export function useBookHighlights(
  note: string,
  viewRef: RefObject<FoliateView | null>,
): BookHighlights {
  // The key the editor writes and the events stream invalidates, so a highlight
  // deleted by hand stops being drawn. The draw pass reads `reading:` again: one
  // small GET costs less than sharing the text with the view effect.
  const { data: text } = useQuery({ queryKey: ["note", note], queryFn: () => fetchNote(note) });

  /** Every highlight the note holds, and a stable identity for the effect below. */
  const blocks = useMemo(() => highlightBlocks(text ?? ""), [text]);
  // Read by the `create-overlay` listener, built with the view, so a changing value would tear the book down.
  const blocksRef = useRef(blocks);
  /**
   * What the last pass drew, so the next one can take it off first. The overlay
   * is kept with the id: removing an id from the wrong one does nothing.
   */
  const drawn = useRef<{ overlayer: FoliateOverlayer; id: string }[]>([]);
  /**
   * The overlay each pdf page carries. Weak and keyed on the document, so a page
   * that scrolls off takes its overlay with it, since every turn builds new documents.
   */
  const overlays = useRef(new WeakMap<Document, FoliateOverlayer>());

  /**
   * Draw `blocks` on what is on screen, one walk of each document. An entry with neither an overlayer
   * nor a text layer is skipped: a book still opening, a blank spread half, or a pre-paginated epub.
   */
  const redraw = useCallback(
    (blocks: HighlightBlock[]) => {
      const shown = viewRef.current?.renderer?.getContents?.() ?? [];

      // Removing an id from an overlay that never held it does nothing, so a fresh section needs no bookkeeping.
      for (const { overlayer, id } of drawn.current) overlayer.remove(id);
      drawn.current = [];

      // Read as `pageStyles` reads the palette, so the book, app and highlight share one set of colours.
      // The mark token, not the accent, which is the link colour.
      const colour = getComputedStyle(document.documentElement).getPropertyValue("--k-mark").trim();

      for (const entry of shown) drawOn(entry, blocks, colour, overlays.current, drawn.current);
    },
    [viewRef],
  );

  // The second trigger: an overlay is often built before the note answers, and a new chapter arrives with the blocks unchanged.
  useEffect(() => {
    blocksRef.current = blocks;
    redraw(blocks);
  }, [blocks, redraw]);

  const repaint = useCallback(() => redraw(blocksRef.current), [redraw]);

  // A highlight takes the mark's colour when it is drawn, so a switch draws them again.
  useEffect(() => onThemeChange(repaint), [repaint]);

  /**
   * Watch a pdf page's text layer, the only signal that it is drawable. It fills after the page loads
   * with no event at the end, so the layer's children are the signal for every render.
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

  return { repaint, watchPage, blocks };
}

type Shown = { doc: Document; overlayer?: FoliateOverlayer };

/**
 * Draw `blocks` on one document on screen, adding each to `drawn`. An entry with neither an overlayer
 * nor a text layer draws nothing.
 */
function drawOn(
  entry: Shown,
  blocks: HighlightBlock[],
  colour: string,
  overlays: WeakMap<Document, FoliateOverlayer>,
  drawn: { overlayer: FoliateOverlayer; id: string }[],
): void {
  const overlayer = entry.overlayer ?? pdfOverlay(entry.doc, overlays);
  if (overlayer === undefined) return;
  // Only a hung overlay is this pane's to aim; foliate aims its own.
  if (overlayer !== entry.overlayer) aimOverlay(overlayer, entry.doc);

  const found = findWritten(
    entry.doc,
    blocks.map((block) => block.raw),
  );
  for (const [at, range] of found.entries()) {
    const block = blocks[at];
    // A quote the book no longer holds is skipped silently, unlike `gf`, which answers.
    if (range === null || block === undefined) continue;
    overlayer.add(block.id, range, Overlayer.highlight, { color: colour });
    drawn.push({ overlayer, id: block.id });
  }
}

/** The overlay a pdf page carries, hung on first use and after a re-render. */
function pdfOverlay(
  doc: Document,
  overlays: WeakMap<Document, FoliateOverlayer>,
): FoliateOverlayer | undefined {
  const layer = pdfLayer(doc);
  if (layer === null) return undefined;

  // A re-render removes the old overlay, so a detached element means hang another.
  const held = overlays.get(doc);
  if (held?.element.isConnected) return held;

  const made = hangOverlay(layer);
  overlays.set(doc, made);
  return made;
}
