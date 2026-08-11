import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchBook } from "@/lib/api";
import { type EditorCommands, TERMINAL, TERMINAL_CHORD } from "@/lib/key-bindings";
import { bookPath } from "@/lib/note-path";
// Static, and for the side effect: loading the module runs
// `customElements.define("foliate-view", View)`. Without it
// `document.createElement("foliate-view")` makes an unknown element, `open` is
// undefined, and the failure reads like a broken fetch. The declaration file in
// `src/foliate-js.d.ts` supplies the types and nothing else.
import "foliate-js/view.js";

/**
 * What the pane asks of foliate's element, which is all it knows about it.
 *
 * Named here rather than reached for through the library's own types, which it
 * ships none of. Both of foliate's shadow roots are closed, so this list and
 * the events it emits are the whole seam.
 */
interface FoliateView extends HTMLElement {
  open(file: File): Promise<void>;
  init(options: object): Promise<void>;
  close(): void;
  next(): void;
  prev(): void;
  /** Built by `open`, and a fixed-layout book's renderer has no `setStyles`. */
  renderer?: { setStyles?: (css: string) => void };
}

interface BookPaneProps {
  /** The literature note this reads beside. The book is its path, suffix swapped. */
  note: string;
  /** Every note the vault holds, so the pane can see its own note leave. */
  paths?: string[];
  /** What a chord reaches. The route hands down the same object the editors get. */
  commands: EditorCommands;
  /** Raised when the pane this sits in has been moved to. See `Editor`. */
  focusSignal?: number;
  /**
   * Called when a click or a Tab lands inside the book. Neither reaches the
   * route on its own. It answers this the way it answers a click into any other
   * pane.
   */
  onFocus: () => void;
}

/**
 * The book's page in the app's own colours.
 *
 * The same CSS variables `oneTheme()` in `terminal-pane.tsx` reads, so the page
 * matches the editor beside it and the palette stays in `app.css`. That
 * function is private to its file, hence the second reader rather than an
 * export. Nothing sets a font, a size or a column count: the book's own
 * typography is the book's, and fitting is foliate's job.
 */
function pageStyles(): string {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();

  return [
    `html, body { background: ${read("--color-one-bg")}; color: ${read("--color-one-fg")}; }`,
    `a { color: ${read("--color-one-accent")}; }`,
  ].join("\n");
}

/**
 * One book in one pane, read beside the note it belongs to.
 *
 * Nothing stores the book's path: it is the note's with the suffix swapped, so
 * a folder move carries the pair and a rename of the note alone orphans the
 * book, which this says out loud.
 */
export function BookPane({ note, paths, commands, focusSignal, onFocus }: BookPaneProps) {
  const wrapper = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<FoliateView | null>(null);
  /** Whether foliate could not read what the vault handed it. */
  const [broken, setBroken] = useState(false);

  // Read through refs, the way `terminal-pane.tsx` reads the same prop. The
  // view is built in one effect keyed on the bytes, and naming these in its
  // dependencies would rebuild it every time the route's memo took a new
  // identity, which is on every vault write.
  const commandsRef = useRef(commands);
  const onFocusRef = useRef(onFocus);
  useEffect(() => {
    commandsRef.current = commands;
    onFocusRef.current = onFocus;
  });

  /**
   * Every key the reader answers, whichever document it was pressed in.
   *
   * The modifiers are compared for equality rather than tested for truth, the
   * way `terminal-pane.tsx` compares them: Chrome spends `Ctrl+H` on its
   * history window, and a handler reading `event.key` alone would turn that
   * into a page turn.
   */
  const onKeyDown = useCallback((event: KeyboardEvent) => {
    const chord =
      event.ctrlKey === TERMINAL_CHORD.ctrlKey &&
      event.shiftKey === TERMINAL_CHORD.shiftKey &&
      event.altKey === TERMINAL_CHORD.altKey &&
      event.metaKey === TERMINAL_CHORD.metaKey;

    if (chord) {
      // From `TERMINAL` rather than a table of this pane's own, so retuning a
      // chord retunes both panes.
      const binding = TERMINAL.find((row) => row.key === event.key);
      if (binding === undefined) return;
      event.preventDefault();
      commandsRef.current[binding.command]();
      return;
    }

    if (event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return;

    // No leader: the pane holds a document you page with the space bar in every
    // other reader, and the chords already carry the way out.
    if (event.key === "l") viewRef.current?.next();
    else if (event.key === "h") viewRef.current?.prev();
    else if (event.key === "q") commandsRef.current.closeNote();
    else return;

    event.preventDefault();
  }, []);

  /** That a click or a Tab landed in the book, which no ancestor is told. */
  const report = useCallback(() => onFocusRef.current(), []);

  // On the wrapper as well as on every section, and in an effect of its own so
  // it survives a book that never opened: the error panel answers `q` too.
  useEffect(() => {
    const element = wrapper.current;
    element?.addEventListener("keydown", onKeyDown);
    return () => element?.removeEventListener("keydown", onKeyDown);
  }, [onKeyDown]);

  // A query rather than an effect, so two panes reading one book share the blob
  // and so an upload has a key to invalidate.
  const { data: blob, error } = useQuery({
    queryKey: ["book", bookPath(note)],
    queryFn: () => fetchBook(bookPath(note)),
  });

  useEffect(() => {
    const element = host.current;
    // An empty file is a book foliate throws `NotFoundError` for, which reads
    // as a broken library rather than as an empty file. Refused up here.
    if (element === null || blob === undefined || blob.size === 0) return;

    setBroken(false);
    let cancelled = false;
    const view = document.createElement("foliate-view") as FoliateView;
    viewRef.current = view;
    element.append(view);

    // Registered before the book opens, so the first section's document does
    // not slip past. Keys pressed inside foliate's iframe reach neither this
    // wrapper nor the window, an event not crossing a document boundary, and a
    // click inside it fires no focus event on any ancestor either. This is the
    // only seam: foliate builds both iframes behind closed shadow roots.
    const sections: Document[] = [];
    function onLoad(event: Event) {
      const { doc } = (event as CustomEvent<{ doc: Document }>).detail;
      doc.addEventListener("keydown", onKeyDown);
      // Two listeners for two ways in, and neither covers the other. A
      // paragraph cannot hold focus, so a real click fires `pointerdown`,
      // `mousedown` and `click` here and nothing else; Tab into one of the
      // book's links fires only `focusin`.
      doc.addEventListener("pointerdown", report);
      doc.addEventListener("focusin", report);
      sections.push(doc);
    }
    view.addEventListener("load", onLoad);
    // `View.open` takes a `File` and calls `makeBook` itself, so kasten imports
    // nothing of the library but the module. Built out here because a hoisted
    // function body does not see the narrowing the guard above did.
    const file = new File([blob], bookPath(note));

    async function draw() {
      try {
        await view.open(file);
        // Not a bare return: the cleanup already ran while `open` was in
        // flight, and there was no renderer to close then. This is the close
        // that actually frees one.
        if (cancelled) {
          view.close();
          return;
        }
        // The `?.` is load-bearing. foliate swaps in `fixed-layout.js` for a
        // pre-paginated book and that renderer has no `setStyles`, so a plain
        // call throws on a valid epub.
        view.renderer?.setStyles?.(pageStyles());
        // Not optional. `View.open` builds the renderer and mounts it but
        // navigates nowhere, so a pane that stops above draws a blank page and
        // every key looks broken.
        await view.init({});
        if (cancelled) view.close();
      } catch (error_) {
        // Every way a book fails to open arrives as an `Error`: a `NotFoundError`
        // from foliate, a throw from the zip reader for a file that is not an
        // archive. Anything else came from somewhere this cannot report on.
        if (!(error_ instanceof Error)) throw error_;
        if (!cancelled) setBroken(true);
      }
    }
    void draw();

    return () => {
      cancelled = true;
      view.removeEventListener("load", onLoad);
      for (const doc of sections) {
        doc.removeEventListener("keydown", onKeyDown);
        doc.removeEventListener("pointerdown", report);
        doc.removeEventListener("focusin", report);
      }
      viewRef.current = null;
      view.close();
      view.remove();
    };
  }, [blob, note, onKeyDown, report]);

  // Mount included, the way the editor and the terminal read the same prop: a
  // freshly split pane is created focused and its first render is the only
  // chance it gets to say so. An unfocused pane is handed 0 and stays put.
  //
  // Not optional in this slice, though the plan filed it under the next one:
  // splitting remounts the editor beside this pane, and that editor takes the
  // cursor back on mount when nothing else holds it. Without this the route
  // never believes the reader is the focused pane.
  useEffect(() => {
    if (focusSignal) wrapper.current?.focus();
  }, [focusSignal]);

  // The listing having not arrived is not the same as the note being gone, so
  // an undefined `paths` says nothing.
  const orphaned = paths !== undefined && !paths.includes(note);
  const failed = broken || error !== null || orphaned || (blob !== undefined && blob.size === 0);

  return (
    // `tabIndex={-1}` so the wrapper can hold the cursor without joining the
    // tab order, the way `todo-pane.tsx` takes it.
    <div ref={wrapper} data-book-pane tabIndex={-1} className="relative h-full w-full outline-none">
      <div ref={host} className="h-full w-full" />
      {failed && (
        <div
          role="alert"
          className="absolute inset-0 flex items-center justify-center bg-one-bg p-6 text-center font-mono text-one-muted text-sm"
        >
          <p>
            No book at <span className="text-one-fg">{bookPath(note)}</span>
          </p>
        </div>
      )}
    </div>
  );
}
