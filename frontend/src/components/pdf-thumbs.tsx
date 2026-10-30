import { type Ref, useEffect, useImperativeHandle, useRef } from "react";
import { type PdfFile, pageColors } from "@/lib/book/pdf-view";

/** Pane width from which the thumbnail column draws. Measured on the pane, not the window. */
export const THUMBS_FROM = 900;

/** The column's width in CSS pixels, which a thumbnail is drawn at, times the pixel ratio. */
const THUMB_WIDTH = 112;

export interface ThumbsHandle {
  /** Draws the thumbnails in view again, in the colours on screen now. */
  redraw(): void;
}

interface PdfThumbsProps {
  file: PdfFile;
  /** The page the pane is on, marked in the column. */
  current: number;
  onGoTo: (page: number) => void;
  ref?: Ref<ThumbsHandle>;
}

/** The button of one page in the column, or null when the column does not hold that page. */
function slotOf(root: HTMLElement, number: number): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-thumb='${number}']`);
}

/** Gives a canvas's bitmap back at once, the way the pages in the box are freed. */
function free(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

/**
 * Draws page `number` onto a fresh canvas and shows it in `slot` once drawn. pdf.js
 * refuses a second render onto a busy canvas, and the slot keeps the old one until the new is ready.
 */
function paint(
  file: PdfFile,
  number: number,
  slot: HTMLElement,
  drawing: Map<number, HTMLCanvasElement>,
) {
  const canvas = document.createElement("canvas");
  canvas.style.width = "100%";
  // A block, not an inline box: an inline canvas sits on the text baseline and
  // leaves a gap under the thumbnail.
  canvas.style.display = "block";
  drawing.set(number, canvas);
  const wanted = () => drawing.get(number) === canvas;
  void file
    .page(number)
    .then(async (page) => {
      if (!wanted()) return;
      // The button takes its own page's shape, so a page taller or wider than A4
      // does not change the column's height when drawn or freed.
      slot.style.aspectRatio = `${page.width} / ${page.height}`;
      await page.draw(canvas, (THUMB_WIDTH * window.devicePixelRatio) / page.width, pageColors());
      if (!wanted()) {
        free(canvas);
        return;
      }
      drawing.delete(number);
      const shown = slot.querySelector("canvas");
      if (shown !== null) free(shown);
      slot.replaceChildren(canvas);
    })
    // A page that will not draw leaves its thumbnail as it was: the pane above
    // reports a failed pdf already, so nothing is lost by not reporting it twice.
    .then(undefined, () => {
      if (wanted()) drawing.delete(number);
      free(canvas);
    });
}

/**
 * A column of page thumbnails on the left of the pdf pane, each drawn while in view.
 *
 * Only the pages on screen hold a bitmap: a long pdf costs the pages the column
 * is showing, the way the page box does, so the column scrolls on its own.
 */
export function PdfThumbs({ file, current, onGoTo, ref }: PdfThumbsProps) {
  const column = useRef<HTMLDivElement>(null);
  /** The pages in view now, which are the only ones a redraw has to paint. */
  const shown = useRef(new Set<number>());
  /** The canvas of each page's latest draw, which is the one that may still land. */
  const drawing = useRef(new Map<number, HTMLCanvasElement>());

  useEffect(() => {
    const root = column.current;
    if (root === null) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const number = Number((entry.target as HTMLElement).dataset.thumb);
          const slot = slotOf(root, number);
          if (slot === null) continue;
          if (entry.isIntersecting) {
            shown.current.add(number);
            paint(file, number, slot, drawing.current);
          } else {
            shown.current.delete(number);
            drawing.current.delete(number);
            const canvas = slot.querySelector("canvas");
            if (canvas !== null) free(canvas);
            slot.replaceChildren();
          }
        }
      },
      { root },
    );
    for (const slot of root.querySelectorAll("[data-thumb]")) observer.observe(slot);
    return () => {
      observer.disconnect();
      for (const number of shown.current) {
        const slot = slotOf(root, number);
        const canvas = slot?.querySelector("canvas");
        if (canvas) free(canvas);
        slot?.replaceChildren();
      }
      shown.current.clear();
      drawing.current.clear();
    };
  }, [file]);

  useImperativeHandle(
    ref,
    () => ({
      redraw() {
        const root = column.current;
        if (root === null) return;
        for (const number of shown.current) {
          const slot = slotOf(root, number);
          if (slot !== null) paint(file, number, slot, drawing.current);
        }
      },
    }),
    [file],
  );

  return (
    <nav
      ref={column}
      aria-label="Pages"
      className="flex min-h-0 w-28 shrink-0 flex-col gap-2 overflow-y-auto border-r border-k-rule p-2"
    >
      {Array.from({ length: file.pages }, (_, index) => {
        const number = index + 1;
        const here = number === current;
        return (
          <button
            key={number}
            type="button"
            data-thumb={number}
            aria-label={`Page ${number}`}
            aria-current={here ? "page" : undefined}
            onClick={() => onGoTo(number)}
            // The accent ring is the mark of the page on screen, drawn inside the
            // button so the column's own scroll does not clip it.
            // The shape of an A4 page holds the button's height until its page is
            // drawn into it, the canvas that draws it being swapped in by `paint`.
            className={`block aspect-[1/1.414] w-full shrink-0 outline-k-accent -outline-offset-2 pointer-coarse:min-h-11 ${here ? "outline-2" : "outline-0"} focus-visible:outline-2`}
          />
        );
      })}
    </nav>
  );
}
