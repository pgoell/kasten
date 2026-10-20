import { backImages } from "@/lib/book-backing";
import { type FoliateView, pdfLayer } from "@/lib/foliate-view";

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
 * What the pane does with a page as it arrives and as it is watched.
 *
 * `arrived` runs before the page is recorded, so a passage held in a section
 * that has just left the tree is forgotten first. `watch` answers the observer
 * to disconnect when the page leaves.
 */
export interface PageHooks {
  arrived(doc: Document): void;
  watch(doc: Document): MutationObserver | undefined;
}

/**
 * Track every page the book shows, from its `load` until the page leaves.
 *
 * Registered before the book opens, so the first section's document does
 * not slip past. Keys pressed inside foliate's iframe reach neither this
 * wrapper nor the window, an event not crossing a document boundary, and a
 * click inside it fires no focus event on any ancestor either. This is the
 * only seam: foliate builds both iframes behind closed shadow roots.
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
  }[] = [];

  function onLoad(event: Event) {
    const { doc, index } = (event as CustomEvent<{ doc: Document; index: number }>).detail;
    doc.addEventListener("keydown", listeners.keydown);
    // Two listeners for two ways in, and neither covers the other. A
    // paragraph cannot hold focus, so a real click fires `pointerdown`,
    // `mousedown` and `click` here and nothing else; Tab into one of the
    // book's links fires only `focusin`.
    doc.addEventListener("pointerdown", listeners.report);
    doc.addEventListener("focusin", listeners.report);
    doc.addEventListener("selectionchange", listeners.selectionchange);
    doc.addEventListener("click", listeners.click);
    hooks.arrived(doc);
    forgetPagesThatLeft();
    // A pdf page holds a canvas and no img, so `backImages` finds nothing there.
    sections.push({ doc, index, watcher: hooks.watch(doc), images: backImages(doc) });
  }
  view.addEventListener("load", onLoad);

  /**
   * Drop the pages that have gone, which nothing else here would.
   *
   * A fixed-layout book builds a new frame and a new document for every turn
   * and calls `replaceChildren` on the old ones (`fixed-layout.js:167`), where
   * a flowing book loads a section at a time and has a few dozen at most. So
   * this list is the difference between a reader that holds two pages and one
   * that holds every page you have read, each with its own canvas, which for
   * a long pdf is hundreds of megabytes. `defaultView` is null on a document
   * whose frame has left the tree, and is the only way to ask.
   *
   * The listeners are not taken off, and do not need to be: they were added to
   * a document that is going away with them.
   */
  function forgetPagesThatLeft() {
    for (let at = sections.length - 1; at >= 0; at -= 1) {
      const page = sections[at];
      if (page === undefined || page.doc.defaultView !== null) continue;
      page.watcher?.disconnect();
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
    // `trim` and not foliate's own normaliser, which strips ASCII whitespace
    // alone (`epub.js:64-67`) while the nav path falls back to a raw `title`
    // attribute nothing normalises. A label of one non-breaking space is
    // truthy to the library and empty here, which is what keeps the chapter
    // line from being a bare caret.
    if (label !== undefined && label !== null && label.trim() !== "") return label;
    // The book's own words or a number, and never the section document's
    // `<title>`: a great many books put the book's title in every chapter
    // file, so that fallback would write the same wrong words throughout.
    //
    // A pdf's outline is used above wherever there is one, so this is the
    // only line that has to know what it is reading, and a pdf has pages
    // where a book has sections.
    //
    // The number comes off the page the words are on and not off the view,
    // which is the same thing in a pane showing one page and not in a pane
    // showing a spread: nothing relocates when you select on the facing page,
    // so the view still names the other one. `lastLocation` is the fallback
    // for a flowing book, whose documents `load` reports the same way but
    // whose sections and pages are not the same count.
    if (pdfLayer(doc) === null) return `Section ${(view.lastLocation?.section?.current ?? 0) + 1}`;
    return `Page ${(pageOf(doc) ?? view.lastLocation?.section?.current ?? 0) + 1}`;
  }

  return {
    chapterOf,
    dispose() {
      view.removeEventListener("load", onLoad);
      for (const { doc, watcher, images } of sections) {
        watcher?.disconnect();
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
