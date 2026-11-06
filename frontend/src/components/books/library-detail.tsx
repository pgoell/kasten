import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  CHOSEN,
  coverUrl,
  type LibraryBook,
  lastRead,
  percent,
  STATUS_WORDS,
  type Status,
  shelfName,
} from "@/components/books/library";
import { fetchNote } from "@/lib/core/api";
import { highlightBlocks } from "@/lib/takes/highlight";

/** What the detail side can ask of the pane, each one a key there too. */
export interface DetailActions {
  read: () => void;
  openNote: () => void;
  makeCurrent: () => void;
  toggleHidden: () => void;
  setStatus: (status: (typeof CHOSEN)[number]) => void;
  toggleMoving: () => void;
  moveTo: (folder: string) => void;
}

const BUTTON =
  "inline-flex h-9 items-center gap-2 rounded-md border border-k-rule bg-k-paper px-3 text-k-13 text-k-ink hover:bg-k-accent-wash pointer-coarse:h-11";
const KEY = "font-mono text-k-12 text-k-muted";

/** The tag slot a title hashes to, so a book without a cover keeps one colour between visits. */
function slot(title: string): string {
  let hash = 0;
  for (const char of title) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return `var(--tg-${(hash % 10) + 1})`;
}

/** The epub's own cover, or a plain one with the title where the book names none. */
export function Cover({ book, size }: { book: LibraryBook; size: "small" | "large" }) {
  const [failed, setFailed] = useState<string>();
  const box = size === "large" ? "h-60 w-40" : "h-9 w-6";
  if (book.format !== "epub" || failed === book.path) {
    return (
      <div
        aria-hidden="true"
        className={`${box} flex shrink-0 overflow-hidden rounded border-l-4 bg-k-surface`}
        style={{ borderLeftColor: slot(book.title) }}
      >
        {size === "large" && (
          <span className="p-3 font-serif text-k-19 leading-tight text-k-ink-soft">
            {book.title}
          </span>
        )}
      </div>
    );
  }
  return (
    <img
      src={coverUrl(book)}
      alt=""
      loading="lazy"
      onError={() => setFailed(book.path)}
      className={`${box} shrink-0 rounded object-cover shadow-sm`}
    />
  );
}

function Highlights({ book }: { book: LibraryBook }) {
  // The editor's key, so a highlight taken in the reader shows here with no wiring.
  const text = useQuery({ queryKey: ["note", book.path], queryFn: () => fetchNote(book.path) });
  if (book.highlights === 0) return null;
  const lines = text.data?.split("\n") ?? [];
  const blocks = highlightBlocks(text.data ?? "").reverse();
  return (
    <section aria-label="highlights" className="flex max-w-[44rem] flex-col gap-4">
      <h2 className="flex items-baseline gap-3 border-b border-k-rule-strong pb-2 font-serif text-k-23 font-normal">
        Highlights
        <span className="font-sans text-k-13 text-k-muted">newest first</span>
      </h2>
      {blocks.map((block) => (
        <figure key={block.id} className="m-0 flex flex-col gap-1">
          <blockquote className="m-0 w-fit rounded-sm bg-k-mark px-1.5 font-serif text-k-19">
            {block.quote.join(" ")}
          </blockquote>
          <figcaption className="text-k-12 text-k-muted">
            {(lines[block.to - 1] ?? "").replace(/\s*\^hl-\w+\s*$/, "")}
          </figcaption>
        </figure>
      ))}
    </section>
  );
}

/** The chosen book: its cover, where you are in it, its status, what can be done, its highlights. */
export function LibraryDetail({
  book,
  shelves,
  moving,
  today,
  actions,
}: {
  book: LibraryBook;
  shelves: string[];
  /** Whether the shelf picker is open, which `m` toggles. */
  moving: boolean;
  today: Date;
  actions: DetailActions;
}) {
  const shown = percent(book);
  const when = lastRead(book, today);
  const facts = [
    shown === null ? null : `${shown}% read`,
    when === null ? "never opened" : `last read ${when}`,
    `${book.highlights} highlight${book.highlights === 1 ? "" : "s"}`,
  ].filter(Boolean);
  const others = shelves.filter((folder) => folder !== book.folder);

  return (
    <div className="flex min-w-0 flex-col gap-7 px-6 py-8 @3xl:px-14">
      <div className="flex flex-col gap-6 @xl:flex-row">
        <Cover book={book} size="large" />
        <div className="flex min-w-0 flex-col gap-3">
          <p className="m-0 text-k-12 font-semibold tracking-wide text-k-accent uppercase">
            {shelfName(book.folder)}
            {book.current && " · current book"}
            {book.hidden && " · hidden"}
          </p>
          <h1 className="m-0 font-serif text-k-36 font-normal">{book.title}</h1>
          {book.author && <p className="m-0 text-k-15 text-k-ink-soft">{book.author}</p>}
          <div className="mt-2 flex max-w-md flex-col gap-1.5">
            <div className="h-1.5 rounded-full bg-k-surface">
              <div className="h-1.5 rounded-full bg-k-accent" style={{ width: `${shown ?? 0}%` }} />
            </div>
            <p className="m-0 text-k-13 text-k-muted">{facts.join(" · ")}</p>
          </div>
          <fieldset className="m-0 mt-1 flex w-fit flex-wrap gap-1 rounded-md border-0 bg-k-surface p-1">
            <legend className="sr-only">Status, s steps through it</legend>
            {CHOSEN.map((status) => (
              <StatusButton
                key={status}
                status={status}
                on={book.status === status}
                set={() => actions.setStatus(status)}
              />
            ))}
          </fieldset>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={actions.read}
              disabled={book.format === null}
              className="inline-flex h-10 items-center rounded-md bg-k-accent px-4 text-k-15 font-semibold text-k-paper disabled:opacity-50 pointer-coarse:h-11"
            >
              {book.progress ? "Continue reading" : "Start reading"}{" "}
              <span aria-hidden className="ml-1.5">
                ↵
              </span>
            </button>
            <button type="button" onClick={actions.openNote} className={BUTTON}>
              Open note <span className={KEY}>o</span>
            </button>
            <button type="button" onClick={actions.makeCurrent} className={BUTTON}>
              Make current <span className={KEY}>r</span>
            </button>
            <button type="button" onClick={actions.toggleHidden} className={BUTTON}>
              {book.hidden ? "Show again" : "Hide"} <span className={KEY}>x</span>
            </button>
            <button
              type="button"
              onClick={actions.toggleMoving}
              aria-expanded={moving}
              className={BUTTON}
            >
              Move to shelf <span className={KEY}>m</span>
            </button>
          </div>
          {book.format === null && (
            <p className="m-0 text-k-13 text-k-danger">Nothing to read beside this note</p>
          )}
          {moving && (
            <fieldset className="m-0 flex flex-wrap gap-2 border-0 p-0">
              <legend className="sr-only">Move to shelf</legend>
              {others.length === 0 && (
                <p className="m-0 text-k-13 text-k-muted">No other shelf holds a book yet</p>
              )}
              {others.map((folder, at) => (
                <button
                  key={folder}
                  type="button"
                  onClick={() => actions.moveTo(folder)}
                  className={BUTTON}
                  title={folder}
                >
                  {at < 9 && <span className={KEY}>{at + 1}</span>} {shelfName(folder)}
                </button>
              ))}
            </fieldset>
          )}
        </div>
      </div>
      <Highlights book={book} />
    </div>
  );
}

function StatusButton({ status, on, set }: { status: Status; on: boolean; set: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={set}
      className={`h-8 rounded px-3 text-k-13 pointer-coarse:h-11 ${
        on ? "bg-k-paper font-semibold text-k-accent shadow-sm" : "text-k-ink-soft"
      }`}
    >
      {STATUS_WORDS[status]}
    </button>
  );
}
