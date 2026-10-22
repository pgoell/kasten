import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { BookPane } from "@/components/book-pane";
import { addHighlight } from "@/lib/highlight";
import { lastView, selectIn } from "./foliate-fake";
import { stubCommands } from "./stub-commands";

export const NOTE = "20 Literature/DDIA.md";
/** The file the vault answers sits beside it, which the pane works out none of. */
export const BOOK = "20 Literature/DDIA.epub";

/**
 * The dark `--k-bg`, set on the page by the styling case so it has a value to find.
 * It is the same hex as the token in `kasten-theme.css`, so the case does not
 * depend on the stylesheet being loaded.
 */
export const BACKGROUND = "#141414";

/** A place in a book, as the note's block holds it. */
export const CFI = "epubcfi(/6/14!/4/2/2/1:0)";

/**
 * A two entry contents, carrying the ids foliate stamps on the real thing.
 *
 * Written here rather than left off: `assignIDs` runs inside `TOCProgress.init`
 * (`progress.js:2-10`), which only the real `View.open` calls, and a toc with no
 * ids leaves every row and the current item at undefined, which matches the
 * first row whatever the book is showing.
 */
export const CHAPTERS = [
  { id: 0, label: "One", href: "ch1.xhtml" },
  { id: 1, label: "Two", href: "ch2.xhtml" },
];

/** The literature note, with `reading:` set or with nothing in the block. */
export function noteWith(cfi?: string): string {
  return [
    "---",
    "id: one",
    ...(cfi === undefined ? [] : [`reading: ${cfi}`]),
    "---",
    "# DDIA",
  ].join("\n");
}

/** Two passages the drawing cases plant in the section and in the note. */
export const PASSAGE = "Systems that tolerate faults are called fault-tolerant.";
export const OTHER = "A system that is reliable does what the user expects.";
export const IDS = ["hl-a3f9c1", "hl-b2c4d6"];

/**
 * A note holding one highlight per quote, written by the format's own writer.
 *
 * Through `addHighlight` rather than typed out, so a case is drawing what the
 * take actually writes.
 */
export function noteHolding(...quotes: string[]): string {
  return quotes.reduce(
    (note, quote, at) => addHighlight(note, { text: quote, chapter: "One" }, IDS[at] as string),
    noteWith(),
  );
}

export function draw(props: { note?: string; paths?: string[]; seed?: Blob; held?: string } = {}) {
  const commands = stubCommands();
  const onFocus = vi.fn();
  const onMoved = vi.fn();
  const onLeaving = vi.fn();
  const onTake = vi.fn();
  const onNotice = vi.fn();
  const client = new QueryClient({
    // Never stale, so nothing refetches behind a test that already has its blob.
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  // Seeded so the very first render already has bytes. The effect returns early
  // while the query is pending, and StrictMode double-invokes on mount only, so
  // without this the double mount happens before there is a book to open.
  // Under the note's own path, which is the key the pane reads and the route
  // invalidates: the file's path is what the answer carries rather than what
  // the question asked.
  if (props.seed) {
    client.setQueryData(["book", props.note ?? NOTE], { path: BOOK, blob: props.seed });
  }
  // The note the pane draws from, seeded for the reason the blob is: the
  // drawing cases emit an overlay by hand and the note has to be in before
  // they do.
  if (props.held !== undefined) client.setQueryData(["note", props.note ?? NOTE], props.held);
  const tree = (focusSignal: number, seek?: { quote: string[] }) => {
    const pane = (
      <QueryClientProvider client={client}>
        <BookPane
          note={props.note ?? NOTE}
          paths={props.paths}
          commands={commands}
          focusSignal={focusSignal}
          seek={seek}
          onFocus={onFocus}
          onMoved={onMoved}
          onLeaving={onLeaving}
          onTake={onTake}
          onNotice={onNotice}
        />
      </QueryClientProvider>
    );
    return props.seed ? <StrictMode>{pane}</StrictMode> : pane;
  };

  const view = render(tree(0));
  return {
    ...view,
    /** The cache the pane reads its note out of, so a case can change the note. */
    client,
    commands,
    onFocus,
    onMoved,
    onLeaving,
    onTake,
    onNotice,
    /** Hand the pane another focus signal, the way the route does. */
    signal: (focusSignal: number) => view.rerender(tree(focusSignal)),
    /** Hand the pane a passage, the way the route does after `gf`. A new object every press. */
    send: (quote: string[]) => view.rerender(tree(0, { quote })),
    /** Hand it the very same seek object again, which is what StrictMode does. */
    hold: (seek: { quote: string[] }) => view.rerender(tree(0, seek)),
    /** The pane's own wrapper, which is what a signal puts the cursor on. */
    wrapper: () => view.container.querySelector("[data-book-pane]"),
  };
}

/** The panel the pane draws instead of a book, or null while it is reading one. */
export function panel(): HTMLElement | null {
  return screen.queryByRole("alert");
}

/** What the line at the bottom of the pane says, which is nothing until it knows. */
export function progress(): string {
  return document.querySelector("[data-book-pane] footer")?.textContent ?? "";
}

/** What the contents are showing, and nothing at all while they are shut. */
export function rows(): (string | null)[] {
  return screen.queryAllByRole("option").map((row) => row.textContent);
}

/** Select `text` in a section document, inside `act` because the pane renders. */
export function selects(text: string, doc: Document = lastView().section) {
  act(() => selectIn(doc, text));
}

/** A one pixel png, which is what a book's figure is in these cases. */
export const PLATE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

/** Where a figure lands, which is the folder a pasted image lands in. */
export const FILED = /^99 Misc\/02 Assets\/01 Images\/\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\.png$/;

/** Select `text` and the figure above it, the way a drag over a plate does. */
export function selectsFigure(text: string, doc: Document = lastView().section) {
  act(() => selectIn(doc, text, PLATE));
}

/** Let go of what was selected, which a click in the book does. */
export function selectsNothing(doc: Document = lastView().section) {
  doc.getSelection = () => null;
  act(() => doc.dispatchEvent(new Event("selectionchange")));
}
