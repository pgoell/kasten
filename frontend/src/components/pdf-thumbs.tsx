import { type Ref, useEffect, useImperativeHandle, useRef } from "react";
import { type PdfFile, pageColors } from "@/lib/pdf-view";

/**
 * The pane width from which the thumbnail column is drawn.
 *
 * Below it the pages are the whole pane, and a column of thumbnails would leave
 * the page too narrow to read. Measured on the pane itself, not the window, so a
 * split pane narrows its own column.
 */
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

/** The canvas of one page's button, or null when the column does not hold that page. */
function canvasOf(root: HTMLElement, number: number): HTMLCanvasElement | null {
  return root.querySelector<HTMLCanvasElement>(`[data-thumb='${number}'] canvas`);
}

/**
 * Draws one page onto its canvas, unless the page left view while it was loading.
 *
 * A page that will not draw leaves its thumbnail blank. The pane above reports a
 * failed pdf already, so nothing is lost by not reporting it twice.
 */
function paint(file: PdfFile, number: number, canvas: HTMLCanvasElement, wanted: () => boolean) {
  void file.page(number).then(
    (page) => {
      if (!wanted()) return;
      return page.draw(canvas, (THUMB_WIDTH * window.devicePixelRatio) / page.width, pageColors());
    },
    () => undefined,
  );
}

/** Gives a canvas's bitmap back at once, the way the pages in the box are freed. */
function free(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
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

  useEffect(() => {
    const root = column.current;
    if (root === null) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const number = Number((entry.target as HTMLElement).dataset.thumb);
          const canvas = canvasOf(root, number);
          if (canvas === null) continue;
          if (entry.isIntersecting) {
            shown.current.add(number);
            paint(file, number, canvas, () => shown.current.has(number));
          } else {
            shown.current.delete(number);
            free(canvas);
          }
        }
      },
      { root },
    );
    for (const slot of root.querySelectorAll("[data-thumb]")) observer.observe(slot);
    return () => {
      observer.disconnect();
      for (const number of shown.current) {
        const canvas = canvasOf(root, number);
        if (canvas !== null) free(canvas);
      }
      shown.current.clear();
    };
  }, [file]);

  useImperativeHandle(
    ref,
    () => ({
      redraw() {
        const root = column.current;
        if (root === null) return;
        for (const number of shown.current) {
          const canvas = canvasOf(root, number);
          if (canvas !== null) paint(file, number, canvas, () => shown.current.has(number));
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
            className={`block w-full shrink-0 outline-k-accent -outline-offset-2 pointer-coarse:min-h-11 ${here ? "outline-2" : "outline-0"}`}
          >
            <canvas className="block aspect-[1/1.414] w-full" />
          </button>
        );
      })}
    </nav>
  );
}
