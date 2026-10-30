import { backImages, fitCover } from "@/lib/book/book-backing";
import { type FoliateView, pdfLayer } from "@/lib/book/foliate-view";

/**
 * The pane's own listeners for a page's document. The same functions are added
 * and removed, so they keep their identity for the life of the book.
 */
export interface PageListeners {
  keydown(event: KeyboardEvent): void;
  report(): void;
  selectionchange(event: Event): void;
  click(event: MouseEvent): void;
}

/**
 * `arrived` runs before the page is recorded, so a passage in a section that has just left
 * the tree is forgotten first. `watch` returns the observer to disconnect when the page leaves.
 */
export interface PageHooks {
  arrived(doc: Document): void;
  watch(doc: Document): MutationObserver | undefined;
}

/**
 * Track every page the book shows, from its `load` until the page leaves. Keys and clicks in
 * foliate's iframe reach no ancestor, and its frames sit behind closed shadow roots, so this is the seam.
 */
export function trackPages(
  view: FoliateView,
  listeners: PageListeners,
  hooks: PageHooks,
): { chapterOf(doc: Document): string; dispose(): void } {
  const sections: {
    doc: Document;
    index: number;
    watcher?: MutationObserver;
    images?: ResizeObserver;
    fit?: ResizeObserver;
  }[] = [];

  function onLoad(event: Event) {
    const { doc, index } = (event as CustomEvent<{ doc: Document; index: number }>).detail;
    doc.addEventListener("keydown", listeners.keydown);
    // Two ways in, and neither covers the other: a click fires no focus event,
    // and Tab into a link fires no pointer event.
    doc.addEventListener("pointerdown", listeners.report);
    doc.addEventListener("focusin", listeners.report);
    doc.addEventListener("selectionchange", listeners.selectionchange);
    doc.addEventListener("click", listeners.click);
    hooks.arrived(doc);
    forgetPagesThatLeft();
    // Only a flowing book is fitted: a fixed-layout page keeps its own renderer, and a pdf has none to fit to.
    const renderer = view.renderer;
    const fit = renderer?.getAttribute("flow") === "scrolled" ? fitCover(doc, renderer) : undefined;
    // A pdf page holds a canvas and no img, so `backImages` finds nothing there.
    sections.push({ doc, index, watcher: hooks.watch(doc), fit, images: backImages(doc) });
  }
  view.addEventListener("load", onLoad);

  /**
   * Drop the pages that have gone. A fixed-layout book builds a document per turn, each with a canvas,
   * so a long pdf would keep hundreds of megabytes. `defaultView` is null once the frame has left the tree.
   */
  function forgetPagesThatLeft() {
    for (let at = sections.length - 1; at >= 0; at -= 1) {
      const page = sections[at];
      if (page === undefined || page.doc.defaultView !== null) continue;
      page.watcher?.disconnect();
      page.fit?.disconnect();
      page.images?.disconnect();
      sections.splice(at, 1);
    }
  }

  /** Which page of the pdf this document is, off the event that announced it. */
  function pageOf(doc: Document): number | undefined {
    return sections.find((page) => page.doc === doc)?.index;
  }

  /** Where in the book the page is, as the note is to name it. */
  function chapterOf(doc: Document): string {
    const label = view.lastLocation?.tocItem?.label;
    // `trim`: foliate's normaliser keeps a lone non-breaking space, which
    // would leave the chapter line a bare caret.
    if (label !== undefined && label !== null && label.trim() !== "") return label;
    // The book's words or a number, never the section's `<title>`: many books
    // put the book's title in every chapter file. A pdf has pages where a book
    // has sections, so this line alone must know which it reads.
    // The number comes off the page the words are on, not the view: selecting
    // on a facing page does not relocate the view. `lastLocation` is the fallback.
    if (pdfLayer(doc) === null) return `Section ${(view.lastLocation?.section?.current ?? 0) + 1}`;
    return `Page ${(pageOf(doc) ?? view.lastLocation?.section?.current ?? 0) + 1}`;
  }

  return {
    chapterOf,
    dispose() {
      view.removeEventListener("load", onLoad);
      for (const { doc, watcher, fit, images } of sections) {
        watcher?.disconnect();
        fit?.disconnect();
        images?.disconnect();
        doc.removeEventListener("keydown", listeners.keydown);
        doc.removeEventListener("pointerdown", listeners.report);
        doc.removeEventListener("focusin", listeners.report);
        doc.removeEventListener("selectionchange", listeners.selectionchange);
        doc.removeEventListener("click", listeners.click);
      }
    },
  };
}
