import { useEffect, useRef, useState } from "react";
import { HEADER_ROW, LABEL, PANEL, ROW, STATUS } from "@/lib/overlay-styles";

/**
 * The dark sheet, over the pane rather than over the window.
 *
 * `BACKDROP` with `absolute` for `fixed` and `p-4` for `pt-[15vh]`: the reader
 * sits beside a note you are meant to keep seeing, and `15vh` of a window is
 * the wrong measure once the sheet is the size of a pane.
 */
const SHEET =
  "absolute inset-0 z-10 flex items-start justify-center bg-black/50 p-4 focus:outline-none";

/**
 * The panel, bounded by the pane it sits in.
 *
 * Not `PANEL_NARROW`, which measures itself against the viewport
 * (`overlay-styles.ts:29`) and would draw wider than a narrow pane and spill
 * over the note. `max-h-full` keeps it inside the sheet, the pane's wrapper
 * hiding no overflow of its own.
 */
const CONTENTS_PANEL = `${PANEL} w-full max-w-[36rem] max-h-full`;

/** The list, at full width, because `LIST` is half of a two-column body. */
const CONTENTS_LIST = "min-h-0 flex-1 overflow-auto py-1";

/** As much of foliate's own toc item as the walk reads. */
export interface TocItem {
  /**
   * Stamped on the item by foliate's `assignIDs` (`progress.js:2-10`), which
   * `TOCProgress.init` runs over the very array `book.toc` holds. So this is
   * the same number `lastLocation.tocItem` hands back, and it is what the
   * cursor's starting row is found by. A label or an href could not do the job:
   * a book is free to repeat either.
   */
  id?: number;
  label?: string | null;
  href?: string | null;
  subitems?: TocItem[] | null;
}

/** One line of the contents, flattened out of the tree. */
export interface TocRow {
  id: number | undefined;
  /** The label, or the href where the book gave no label. */
  label: string;
  /** Where Enter goes, or null for a heading the book gave no link. */
  href: string | null;
  depth: number;
}

/**
 * The publisher's contents as one flat list, in reading order.
 *
 * A depth-first walk, which is what `flatten` in `progress.js:12-16` does with
 * the same tree, written out here because that function is module-local.
 *
 * An entry the book named nowhere and labelled nothing gets no row, and its
 * children still get theirs at the depth they were found at: the nav parser
 * answers that shape for an `<li>` holding only a nested `<ol>`
 * (`epub.js:318-328`), so pruning there would take a whole part of the book off
 * the list.
 */
export function tocRows(toc: TocItem[] | null | undefined): TocRow[] {
  const rows: TocRow[] = [];

  function walk(items: TocItem[], depth: number) {
    for (const item of items) {
      // Falsiness rather than `=== ""`: the ncx gives `""` (`epub.js:352`) and
      // the nav path gives null or undefined (`epub.js:322`).
      const label = item.label?.trim() || item.href;
      if (label) rows.push({ id: item.id, label, href: item.href ?? null, depth });
      walk(item.subitems ?? [], depth + 1);
    }
  }

  walk(toc ?? [], 0);
  return rows;
}

interface BookContentsProps {
  rows: TocRow[];
  /** Which row the cursor starts on, clamped into range. */
  start: number;
  /** Enter, or a click, on a row that has somewhere to go. */
  onGo: (href: string) => void;
  onClose: () => void;
}

/**
 * The book's chapters over the page, walked with `j`, `k`, Enter and Escape.
 *
 * A component of its own rather than markup inside the pane, because none of
 * what it decides has anything to do with foliate: it is an array and a cursor.
 * There is nothing to type, so the dialog itself takes the focus, which is also
 * what pulls the cursor out of the book's iframe and lets `j` reach React.
 */
export function BookContents({ rows, start, onGo, onClose }: BookContentsProps) {
  const [active, setActive] = useState(start);
  const dialog = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const cursor = Math.min(Math.max(active, 0), rows.length - 1);
  const highlighted = rows[cursor];

  useEffect(() => {
    dialog.current?.focus();
  }, []);

  // Every move, unlike the finder, which never needs it: its highlight starts
  // at row 0 and only goes below the fold once you have walked it there. This
  // one opens on the chapter you are in, and a list whose highlight is off
  // screen at the moment it opens looks like a list with nothing selected.
  useEffect(() => {
    list.current?.children[cursor]?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  /** Open the highlighted chapter, which is the only thing Enter and a click do. */
  function go(row: TocRow) {
    // A part heading the book gave no link. The contents stay open, so the next
    // press can land on a real chapter.
    if (row.href === null) return;
    onGo(row.href);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    // A book whose publisher wrote no contents. The clamp answers -1 there, so
    // every branch below would read a property off undefined.
    if (highlighted === undefined) return;

    switch (event.key) {
      case "j":
        setActive(Math.min(cursor + 1, rows.length - 1));
        break;
      case "k":
        setActive(Math.max(cursor - 1, 0));
        break;
      case "Enter":
        go(highlighted);
        break;
      default:
        return;
    }

    event.preventDefault();
  }

  return (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label="Contents"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={SHEET}
    >
      <div className={CONTENTS_PANEL}>
        <div className={HEADER_ROW}>
          <span className={LABEL}>contents</span>
        </div>

        {/* A div rather than a list, the way the finder builds its own: a
            listbox is not a list of items to a screen reader, and marking it
            as both says it twice. */}
        <div ref={list} role="listbox" aria-label="Chapters" className={CONTENTS_LIST}>
          {rows.map((row, index) => (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: the list is built when the contents open and never reorders, and a book is free to repeat both a label and an href, so a row's place in it is the only identity it has.
              key={index}
              type="button"
              role="option"
              aria-selected={index === cursor}
              // Out of the tab order, because the focus stays on the dialog and
              // the highlight is how the list says what Enter would open. A
              // click still lands here, and opens the same chapter.
              tabIndex={-1}
              onClick={() => go(row)}
              // Indented rather than numbered: most books number their own
              // chapters, and a made-up `1.2.3` would sit beside a real number
              // and disagree with it. Inline, because it replaces the `px-3`
              // `ROW` carries rather than adding to it.
              style={{ paddingLeft: `${0.75 + row.depth * 0.75}rem` }}
              className={`${ROW} truncate ${
                index === cursor ? "bg-one-hover text-one-accent" : "text-one-fg"
              }`}
            >
              {row.label}
            </button>
          ))}
        </div>

        <output className={STATUS}>{rows.length === 0 ? "this book has no contents" : ""}</output>
      </div>
    </div>
  );
}
