/**
 * A book read word by word: an epub out of the section documents foliate
 * builds, a pdf read as a book out of its bytes, and the place moved between a
 * word and a cfi, which is what the book's `reading:` holds.
 *
 * The book pane hands over its view and gets an `RsvpSource` back; nothing
 * outside this module knows a cfi is how a word and a book place meet.
 */

import type { RefObject } from "react";
import type { BookBeside } from "@/lib/api";
import { fetchNote } from "@/lib/api";
import { type FoliateView, pdfLayer } from "@/lib/book/foliate-view";
import { readPdf } from "@/lib/book/use-book-seek";
import { readField } from "@/lib/note-frontmatter";
import { noteName } from "@/lib/note-path";
import { findQuote, firstOf, indexAt, type RsvpSource, type Word } from "@/lib/rsvp";
import { offsetOf, pdfWords, rangeAt, sectionWords } from "@/lib/rsvp-sources";

/** What foliate answers for a cfi: the section, and how to find the place in its document. */
interface Resolved {
  index: number;
  anchor?: (doc: Document) => unknown;
}

/** Whether a book page on screen was drawn by pdf.js, the test `use-book-seek.ts` makes. */
function isPdfBook(view: FoliateView): boolean {
  return (view.renderer?.getContents?.() ?? []).some((entry) => pdfLayer(entry.doc) !== null);
}

/**
 * Every section's words, an epub's out of the documents foliate builds, which
 * are the section's whole text and not just the page on screen.
 */
async function epubWords(view: FoliateView, keep: () => boolean): Promise<Word[]> {
  const words: Word[] = [];
  for (const [index, section] of (view.book?.sections ?? []).entries()) {
    if (!keep()) break;
    if (section.createDocument === undefined) continue;
    words.push(...sectionWords(await section.createDocument(), index));
  }
  return words;
}

/**
 * A pdf read as a book: its words out of the bytes, pdf.js parsing each page's
 * text without drawing it, as the seek in `use-book-seek.ts` does. foliate keeps
 * its own document to itself, so this is a second reading of the same file.
 */
function bookPdfWords(bytes: ArrayBuffer, keep: () => boolean): Promise<Word[]> {
  return readPdf(
    bytes,
    (pdf) =>
      pdfWords(
        pdf.numPages,
        async (page) => (await (await pdf.getPage(page)).getTextContent()).items,
        keep,
      ),
    [],
  );
}

/**
 * The word a cfi points at: the book's `reading:` or a place on screen.
 *
 * Resolved in a document built for the purpose, the one the words were read out
 * of, since a cfi is a path through the section's markup and finds the same
 * node in either. A pdf's sections build no document, so its cfi names a page.
 */
async function wordAtCfi(view: FoliateView, cfi: string, words: Word[]): Promise<number> {
  const resolved = (await view.resolveCFI?.(cfi)) as Resolved | undefined;
  if (resolved === undefined) return 0;
  const section = view.book?.sections?.[resolved.index];
  if (section?.createDocument === undefined || resolved.anchor === undefined) {
    return firstOf(words, resolved.index);
  }
  const doc = await section.createDocument();
  const range = resolved.anchor(doc);
  if (typeof range !== "object" || range === null || !("startContainer" in range)) {
    return firstOf(words, resolved.index);
  }
  return indexAt(words, resolved.index, offsetOf(doc, range as Range));
}

/** The cfi of `word`, for the book's `reading:`. A pdf page's is the page's own. */
async function cfiOfWord(view: FoliateView, word: Word): Promise<string> {
  const section = view.book?.sections?.[word.section];
  if (section?.createDocument === undefined) return view.getCFI(word.section, null);
  const doc = await section.createDocument();
  return view.getCFI(word.section, rangeAt(doc, word.offset));
}

/** The word a selection on screen starts at, or null with nothing selected. */
async function selectedWord(view: FoliateView, words: Word[]): Promise<number | null> {
  for (const { doc, index } of view.renderer?.getContents?.() ?? []) {
    const selection = doc.getSelection();
    const text = selection?.toString().trim() ?? "";
    if (selection === null || text === "") continue;
    // A pdf page carries no index on screen (`fixed-layout.js:308-313`), and
    // its cfi names the page and no more, so the words are looked for.
    if (pdfLayer(doc) !== null || index === undefined) {
      const page = firstOf(words, index ?? view.lastLocation?.section?.current ?? 0);
      return findQuote(words, text, page) ?? page;
    }
    return wordAtCfi(view, view.getCFI(index, selection.getRangeAt(0)), words);
  }
  return null;
}

/**
 * The book in a pane as a text to read. Its place is kept under the file's
 * path, the book being what is read, and moves to and from `reading:` by `r`
 * and `R`.
 */
export function bookSource(o: {
  viewRef: RefObject<FoliateView | null>;
  /** Whether the view has navigated, which `view.book` does not say. */
  ready: RefObject<boolean>;
  beside: BookBeside | undefined;
  note: string;
  onMoved: (cfi: string) => void;
  /** Writes what the bookmark is waiting on, now. */
  onLeavingRef: RefObject<() => void>;
}): RsvpSource {
  const { viewRef, ready, beside, note, onMoved, onLeavingRef } = o;

  function openBook(): FoliateView {
    const view = viewRef.current;
    if (view === null || !ready.current) throw new Error("The book is still opening");
    return view;
  }

  return {
    path: beside?.path ?? note,
    words: async (keep) => {
      const view = openBook();
      if (!isPdfBook(view)) return epubWords(view, keep);
      const bytes = await beside?.blob.arrayBuffer();
      if (bytes === undefined) throw new Error("The book is still opening");
      return bookPdfWords(bytes, keep);
    },
    // The selection when there is one, else the page on screen.
    here: async (words) => {
      const view = openBook();
      const selected = await selectedWord(view, words);
      if (selected !== null) return selected;
      const cfi = view.lastLocation?.cfi;
      return cfi === undefined ? null : wordAtCfi(view, cfi, words);
    },
    book: {
      // The book goes to the word, and the bookmark writes it now rather than
      // in a minute, the reader having asked for it.
      toReading: async (word) => {
        const view = openBook();
        const cfi = await cfiOfWord(view, word);
        await view.goTo(cfi);
        onMoved(cfi);
        onLeavingRef.current();
      },
      // Read off the note, not off the page on screen, which is what `Space r h` is for.
      fromReading: async (words) => {
        const cfi = readField(await fetchNote(note), "reading");
        if (cfi === undefined || cfi === "") throw new Error(`${noteName(note)} has no reading:`);
        return wordAtCfi(openBook(), cfi, words);
      },
    },
  };
}
