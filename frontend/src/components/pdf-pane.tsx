import { useEffect, useRef, useState } from "react";
import { usePdfTake } from "@/components/pdf-take";
import { PdfThumbs, THUMBS_FROM, type ThumbsHandle } from "@/components/pdf-thumbs";
import { Rsvp } from "@/components/rsvp";
import {
  type PdfFile,
  type PdfView,
  pageColors,
  pdfjsRenderer,
  showPdf,
} from "@/lib/book/pdf-view";
import type { EditorCommands } from "@/lib/key-bindings";
import { heldModifier, leaderAction, leaderPrefix } from "@/lib/leader-keys";
import { encodePath } from "@/lib/note-path";
import { findQuote, firstOf, type Word } from "@/lib/rsvp/rsvp";
import { pdfWords } from "@/lib/rsvp/rsvp-sources";
import { type RsvpAsk, useRsvpAsk } from "@/lib/rsvp/use-rsvp";
import { onThemeChange } from "@/lib/theme";
import { beginLeader, paneOpener } from "@/lib/which-key";

interface PdfPaneProps {
  /** Vault-relative path of the pdf to show. */
  path: string;
  /** The page to open at, counted from one; the first when absent. */
  page?: number;
  /** How many times the pane was opened; each new count goes back to `page`. */
  opened: number;
  /** What a leader sequence reaches. The same object every other pane is given. */
  commands: EditorCommands;
  /** Raised when the pane this sits in has been moved to. See `Editor`. */
  focusSignal?: number;
  /** Whether the archive is listed, which the take's note follows. */
  archive?: boolean;
  /** Opens the note of this pdf beside it. */
  onNoteBeside: () => void;
  /** Raised for this pane by `Space r r` and `Space r h`. */
  rsvp?: RsvpAsk;
}

const LABEL = "shrink-0 text-[11px] tracking-wide text-k-muted uppercase";

/** The zoom the buttons and the `+` and `-` keys walk through, in percent. */
const ZOOMS = [50, 75, 100, 125, 150, 200, 300];

// A square on a touch screen, so the glyph has a 44 px target to sit in, centred.
const BUTTON =
  "inline-flex shrink-0 items-center justify-center px-1 text-[13px] text-k-link hover:text-k-accent focus-visible:text-k-accent active:text-k-accent disabled:text-k-muted pointer-coarse:min-h-11 pointer-coarse:min-w-11";

/**
 * One pdf out of the vault, drawn with pdf.js so `#page=N` opens the page (#353).
 * A phone's own viewer ignores `#page`.
 */
export function PdfPane({
  path,
  page,
  opened,
  commands,
  focusSignal,
  archive = false,
  onNoteBeside,
  rsvp,
}: PdfPaneProps) {
  const panel = useRef<HTMLElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  /** The open pdf, which the zoom and the thumbnails are asked of. */
  const view = useRef<PdfView | undefined>(undefined);
  const thumbs = useRef<ThumbsHandle>(null);
  /** The keys of an unfinished leader sequence, starting with the space. */
  const [pending, setPending] = useState("");
  const [file, setFile] = useState<PdfFile>();
  const [current, setCurrent] = useState(page ?? 1);
  const [zoom, setZoom] = useState(100);
  /** Whether the pane is wide enough for the thumbnail column, measured on the pane itself. */
  const [wide, setWide] = useState(false);
  const take = usePdfTake({ path, box, wrapper, archive });
  const reading = useRsvpAsk(rsvp);

  /** The words of the open pdf, a page at a time, pdf.js parsing each page's text without drawing it. */
  async function rsvpWords(keep: () => boolean) {
    if (file === undefined) throw new Error("The pdf is still opening");
    return pdfWords(
      file.pages,
      async (number) => (await (await file.page(number)).content?.()) ?? [],
      keep,
    );
  }

  /** The selection when it is in this pdf, else the page at the top of the box. */
  function rsvpHere(words: Word[]) {
    const page = firstOf(words, current - 1);
    const selection = window.getSelection();
    const inside = selection !== null && box.current?.contains(selection.anchorNode) === true;
    const text = inside ? (selection?.toString().trim() ?? "") : "";
    return text === "" ? page : (findQuote(words, text, page) ?? page);
  }

  // Every open opens the pdf again rather than scrolling the one open, a
  // repeat of the same page too, the reader having maybe scrolled off it: the
  // box is keyed on the count, so `showPdf` gets a fresh one and no listener
  // of the last open is left on it. The take forgets what it held of the last
  // pdf, and the thumbnails wait for this one's file.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `opened` is the reopen signal.
  useEffect(() => {
    const target = box.current;
    if (target === null) return;
    const name = path.slice(path.lastIndexOf("/") + 1);
    take.forget();
    setFile(undefined);
    const next = showPdf(
      target,
      pdfjsRenderer,
      `/api/assets/${encodePath(path)}`,
      name,
      () => {},
      page,
      {
        colors: pageColors,
        textLayer: true,
        zoom: zoom / 100,
        onFile: setFile,
        onPage: setCurrent,
        onText: take.onText,
        pinch: true,
        // The pinch and the double tap move the same zoom the buttons do, so
        // the readout and the next step follow them.
        onZoom: (next) => setZoom(Math.round(next * 100)),
      },
    );
    view.current = next;
    return next;
  }, [path, page, opened]);

  // A theme or palette switch repaints the pages on screen in the new colours,
  // keeping the page and the scroll: the view remembers both itself.
  useEffect(
    () =>
      onThemeChange(() => {
        view.current?.redraw();
        thumbs.current?.redraw();
      }),
    [],
  );

  // The pane's own width decides whether the thumbnail column is drawn. Measured
  // here and not by `usePaneWide`, whose number is the margin's.
  useEffect(() => {
    const element = panel.current;
    if (element === null) return;
    const watch = new ResizeObserver(([entry]) => {
      if (entry) setWide(entry.contentRect.width >= THUMBS_FROM);
    });
    watch.observe(element);
    return () => watch.disconnect();
  }, []);

  // A freshly focused pane takes the cursor, the way the image pane does: it
  // holds no CodeMirror, so without this the keys stay in the note.
  useEffect(() => {
    if (focusSignal) panel.current?.focus();
  }, [focusSignal]);

  /** The zoom a button or a key moves to, or undefined at the end it is already at. */
  const below = ZOOMS.filter((step) => step < zoom);
  const lower = below[below.length - 1];
  const higher = ZOOMS.find((step) => step > zoom);

  function zoomTo(next: number) {
    setZoom(next);
    view.current?.setZoom(next / 100);
  }

  // The image pane's leader block, there being nothing else to press in a pdf.
  function onKeyDown(event: React.KeyboardEvent) {
    const { key } = event;
    if (heldModifier(key)) return;

    // The take first, but not in the middle of a leader sequence, where its keys
    // are the sequence's.
    if (!pending && take.onKeyDown(event)) return;

    if (pending) {
      const sequence = pending + key;
      const wanted = sequence.slice(1);
      const run = leaderAction(wanted, commands);
      setPending(!run && leaderPrefix(wanted) ? sequence : "");
      if (run) {
        event.preventDefault();
        run();
      }
      return;
    }

    if (event.ctrlKey || event.altKey || event.metaKey) return;

    // `=` is the `+` key without shift, so the key that zooms in on a US layout
    // and the one a reader presses to zoom in either way are both taken.
    if (key === "+" || key === "=") {
      event.preventDefault();
      if (higher !== undefined) zoomTo(higher);
      return;
    }
    if (key === "-") {
      event.preventDefault();
      if (lower !== undefined) zoomTo(lower);
      return;
    }

    if (key === " ") {
      if (beginLeader(paneOpener(commands))) {
        event.preventDefault();
        return;
      }
      setPending(key);
      event.preventDefault();
    }
  }

  return (
    <section
      ref={panel}
      data-pdf-pane={path}
      data-page={page}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      aria-label="pdf"
      className="relative flex h-full flex-col bg-k-bg outline-none"
    >
      <header className="flex items-center gap-3 border-b border-k-rule px-3 py-1">
        <span className={LABEL}>PDF</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-k-ink" title={path}>
          {path}
        </span>
        <button
          type="button"
          aria-label="Zoom out"
          disabled={lower === undefined}
          onClick={() => {
            if (lower !== undefined) zoomTo(lower);
          }}
          className={BUTTON}
        >
          {"−"}
        </button>
        <span aria-live="polite" className="shrink-0 text-[13px] text-k-muted tabular-nums">
          {`${zoom}%`}
        </span>
        <button
          type="button"
          aria-label="Zoom in"
          disabled={higher === undefined}
          onClick={() => {
            if (higher !== undefined) zoomTo(higher);
          }}
          className={BUTTON}
        >
          +
        </button>
        <button
          type="button"
          onClick={onNoteBeside}
          // The same look as the HTML pane's link to its browser tab, the one
          // other way out of a pane being a link of the same kind.
          className="inline-flex shrink-0 items-center text-[11px] text-k-link hover:text-k-accent focus-visible:text-k-accent active:text-k-accent pointer-coarse:min-h-11"
        >
          Note beside
        </button>
      </header>
      <div className="flex min-h-0 flex-1">
        {wide && file !== undefined ? (
          <PdfThumbs
            ref={thumbs}
            file={file}
            current={current}
            onGoTo={(number) => view.current?.goTo(number)}
          />
        ) : null}
        {/* The wrapper the take's button is placed in: the pages only, so the
            button and the toast sit over the page area and not the thumbnails. */}
        <div ref={wrapper} className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            key={`${path}#${page}#${opened}`}
            ref={box}
            data-pdf-box
            className="min-h-0 flex-1 overflow-y-auto p-1"
          />
          {take.overlay}
        </div>
      </div>
      {reading.open && (
        <Rsvp
          key={reading.open.signal}
          source={{ path, words: rsvpWords, here: rsvpHere }}
          here={reading.open.here}
          onClose={() => {
            reading.close();
            panel.current?.focus();
          }}
        />
      )}
    </section>
  );
}
