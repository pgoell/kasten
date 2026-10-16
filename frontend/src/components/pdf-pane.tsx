import { useEffect, useRef, useState } from "react";
import { type EditorCommands, heldModifier, leaderAction, leaderPrefix } from "@/lib/key-bindings";
import { encodePath } from "@/lib/note-path";
import { pdfjsRenderer, showPdf } from "@/lib/pdf-view";

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
}

const LABEL = "shrink-0 text-[11px] tracking-wide text-one-muted uppercase";

/**
 * One pdf out of the vault, drawn with pdf.js and opened at a page.
 *
 * Where a followed `![[plan.pdf#page=3]]` or `[[plan.pdf#page=3]]` lands
 * (#353). The browser's own viewer was where it went before, and a phone's
 * viewer ignores `#page`: the tap opened page 1. This draws the pages the way
 * the embed in the note does, with `showPdf`, in a box as tall as the pane.
 */
export function PdfPane({ path, page, opened, commands, focusSignal }: PdfPaneProps) {
  const panel = useRef<HTMLElement>(null);
  const box = useRef<HTMLDivElement>(null);
  /** The keys of an unfinished leader sequence, starting with the space. */
  const [pending, setPending] = useState("");

  // Every open opens the pdf again rather than scrolling the one open, a
  // repeat of the same page too, the reader having maybe scrolled off it: the
  // box is keyed on the count, so `showPdf` gets a fresh one and no listener
  // of the last open is left on it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `opened` is the reopen signal.
  useEffect(() => {
    const target = box.current;
    if (target === null) return;
    const name = path.slice(path.lastIndexOf("/") + 1);
    return showPdf(target, pdfjsRenderer, `/api/assets/${encodePath(path)}`, name, () => {}, page);
  }, [path, page, opened]);

  // A freshly focused pane takes the cursor, the way the image pane does: it
  // holds no CodeMirror, so without this the keys stay in the note.
  useEffect(() => {
    if (focusSignal) panel.current?.focus();
  }, [focusSignal]);

  // The image pane's leader block, there being nothing else to press in a pdf.
  function onKeyDown(event: React.KeyboardEvent) {
    const { key } = event;
    if (heldModifier(key)) return;

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

    if (key === " ") {
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
      className="flex h-full flex-col bg-one-bg font-mono outline-none"
    >
      <header className="flex items-center gap-3 border-b border-one-line px-3 py-1">
        <span className={LABEL}>pdf</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-one-fg" title={path}>
          {path}
        </span>
      </header>
      <div
        key={`${path}#${page}#${opened}`}
        ref={box}
        data-pdf-box
        className="min-h-0 flex-1 overflow-y-auto p-1"
      />
    </section>
  );
}
