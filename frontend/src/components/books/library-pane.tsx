import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  type CHOSEN,
  fetchLibrary,
  grouped,
  type LibraryBook,
  linkTo,
  namingCurrent,
  nextStatus,
  percent,
  STATUS_WORDS,
  shelvesOf,
  withHidden,
  withStatus,
} from "@/components/books/library";
import { Cover, type DetailActions, LibraryDetail } from "@/components/books/library-detail";
import { createNote, fetchFiles, NoteMissing, updateNote } from "@/lib/core/api";
import { READING_NOTE } from "@/lib/core/layout";
import { noteName } from "@/lib/notes/links/note-path";
import type { EditorCommands } from "@/lib/ui/keys/key-bindings";
import { useLeader } from "@/lib/ui/keys/use-leader";
import { moveAndCache } from "@/lib/vault/move/move";

interface LibraryPaneProps {
  commands: EditorCommands;
  focusSignal?: number;
  /** Open the book beside `note` in this pane. */
  onRead: (note: string) => void;
  onOpen: (note: string) => void;
  onNotice: (notice: string) => void;
  today: Date;
}

/** Why a write failed, in a sentence; anything that is not an `Error` is not this pane's to read. */
function said(error: unknown, what: string): string {
  if (!(error instanceof Error)) throw error;
  return `Could not ${what}: ${error.message}`;
}

/** Every book note, a list on one side and the chosen one on the other. Keys as the footer says. */
export function LibraryPane({
  commands,
  focusSignal,
  onRead,
  onOpen,
  onNotice,
  today,
}: LibraryPaneProps) {
  const panel = useRef<HTMLElement>(null);
  const filter = useRef<HTMLInputElement>(null);
  const leader = useLeader(commands);
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [moving, setMoving] = useState(false);
  // By path, not row: a write regroups the list, and the cursor should stay on its book.
  const [chosenPath, setChosenPath] = useState<string>();

  useEffect(() => {
    if (focusSignal) panel.current?.focus();
  }, [focusSignal]);

  const library = useQuery({ queryKey: ["library"], queryFn: fetchLibrary });
  const paths = useQuery({ queryKey: ["files"], queryFn: fetchFiles });
  const books = library.data ?? [];
  const groups = useMemo(() => grouped(books, query, showHidden), [books, query, showHidden]);
  const order = groups.flatMap((group) => group.books);
  const at = Math.max(
    order.findIndex((book) => book.path === chosenPath),
    0,
  );
  const book: LibraryBook | undefined = order[at];
  const hiddenCount = books.filter((each) => each.hidden).length;

  function choose(next: LibraryBook | undefined) {
    setChosenPath(next?.path);
    setMoving(false);
  }

  function move(by: number) {
    choose(order[Math.min(Math.max(at + by, 0), Math.max(order.length - 1, 0))]);
  }

  async function write(change: (text: string) => string, what: string) {
    if (book === undefined) return;
    try {
      await updateNote(book.path, change);
    } catch (error: unknown) {
      onNotice(said(error, what));
    }
    await queryClient.invalidateQueries({ queryKey: ["library"] });
  }

  async function makeCurrent() {
    if (book === undefined) return;
    const link = linkTo(book.path, paths.data ?? []);
    try {
      await updateNote(READING_NOTE, (text) => namingCurrent(text, link));
    } catch (error: unknown) {
      if (!(error instanceof NoteMissing)) {
        onNotice(said(error, "change the current book"));
        return;
      }
      await createNote(READING_NOTE, `${link}\n`);
    }
    onNotice(`${book.title} is the current book`);
    await queryClient.invalidateQueries({ queryKey: ["library"] });
  }

  async function moveTo(folder: string) {
    if (book === undefined) return;
    setMoving(false);
    try {
      const landed = await moveAndCache(
        queryClient,
        "rename",
        book.path,
        folder ? `${folder}/${noteName(book.path)}.md` : `${noteName(book.path)}.md`,
      );
      setChosenPath(landed);
    } catch (error: unknown) {
      onNotice(said(error, "move the book"));
    }
    await queryClient.invalidateQueries({ queryKey: ["library"] });
  }

  const actions: DetailActions = {
    read: () => book?.format && onRead(book.path),
    openNote: () => book && onOpen(book.path),
    makeCurrent: () => void makeCurrent(),
    toggleHidden: () => {
      const hidden = !book?.hidden;
      void write((text) => withHidden(text, hidden), hidden ? "hide the book" : "show the book");
      // Hidden from the list, so the cursor steps on rather than vanishing with it.
      if (hidden && !showHidden) choose(order[at + 1] ?? order[at - 1]);
    },
    setStatus: (status: (typeof CHOSEN)[number]) =>
      void write((text) => withStatus(text, status), "set the status"),
    toggleMoving: () => setMoving((was) => !was),
    moveTo: (folder) => void moveTo(folder),
  };
  const shelves = shelvesOf(books);
  const others = shelves.filter((folder) => folder !== book?.folder);

  const keys: Record<string, ((event: KeyboardEvent) => void) | undefined> = {
    " ": (event) => leader.start(event),
    j: () => move(1),
    ArrowDown: () => move(1),
    k: () => move(-1),
    ArrowUp: () => move(-1),
    g: () => choose(order[0]),
    G: () => choose(order.at(-1)),
    Enter: actions.read,
    o: actions.openNote,
    r: actions.makeCurrent,
    x: actions.toggleHidden,
    ".": () => setShowHidden((was) => !was),
    s: () => book && actions.setStatus(nextStatus(book.status)),
    m: actions.toggleMoving,
    "/": () => filter.current?.focus(),
    q: () => void commands.closeNote(),
    Escape: () => (moving ? setMoving(false) : void commands.closeNote()),
  };

  function onKeyDown(event: KeyboardEvent) {
    if (event.target === filter.current) return;
    if (leader.feed(event)) return;
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const shelf = moving && /^[1-9]$/.test(event.key) ? others[Number(event.key) - 1] : undefined;
    const act = shelf === undefined ? keys[event.key] : () => actions.moveTo(shelf);
    if (act === undefined) return;
    act(event);
    event.preventDefault();
  }

  function onFilterKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" || event.key === "Enter" || event.key === "ArrowDown") {
      event.preventDefault();
      if (event.key === "Escape") setQuery("");
      panel.current?.focus();
    }
  }

  return (
    <section
      ref={panel}
      data-library-pane
      tabIndex={-1}
      onKeyDown={onKeyDown}
      aria-label="library"
      className="@container flex h-full flex-col bg-k-bg font-sans text-k-ink outline-none"
    >
      <div className="flex min-h-0 flex-1 flex-col @2xl:flex-row">
        <nav
          aria-label="books"
          className="flex max-h-[45%] shrink-0 flex-col overflow-y-auto border-b border-k-rule @2xl:max-h-none @2xl:w-80 @2xl:border-r @2xl:border-b-0"
        >
          <div className="flex flex-col gap-2 px-4 pt-4 pb-2">
            <label className="flex h-9 items-center gap-2 rounded-md bg-k-surface px-3 text-k-13 text-k-muted">
              <span aria-hidden className="font-mono text-k-accent">
                /
              </span>
              <input
                ref={filter}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onFilterKey}
                placeholder="Filter by title, author or shelf"
                aria-label="Filter books"
                className="min-w-0 flex-1 bg-transparent text-k-ink outline-none"
              />
            </label>
            <label className="flex items-center gap-2 text-k-12 text-k-muted">
              <input
                type="checkbox"
                checked={showHidden}
                onChange={(event) => setShowHidden(event.target.checked)}
              />
              Show hidden ({hiddenCount}) <span className="font-mono">.</span>
            </label>
          </div>
          {library.isError && (
            <p className="px-4 text-k-13 text-k-danger">The library could not be read</p>
          )}
          {library.isSuccess && order.length === 0 && (
            <p className="px-4 text-k-13 text-k-muted">
              {books.length === 0 ? "No note is typed Book yet" : "No book matches"}
            </p>
          )}
          {groups.map((group) => (
            <div key={group.name} role="listbox" aria-label={group.name} className="pb-2">
              <div className="px-4 pt-2 pb-1 text-k-12 font-semibold tracking-wide text-k-muted uppercase">
                {group.name}
              </div>
              {group.books.map((each) => (
                <Row key={each.path} book={each} on={each === book} pick={() => choose(each)} />
              ))}
            </div>
          ))}
        </nav>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-k-paper">
          {book && (
            <LibraryDetail
              book={book}
              shelves={shelves}
              moving={moving}
              today={today}
              actions={actions}
            />
          )}
        </div>
      </div>
      {/* Keys a finger cannot press, so a touch screen leaves them out. */}
      <footer className="flex flex-wrap gap-x-4 border-t border-k-rule px-3 py-1 text-k-12 text-k-muted pointer-coarse:hidden">
        {[
          ["j k", "move"],
          ["↵", "read"],
          ["o", "note"],
          ["r", "make current"],
          ["s", "status"],
          ["x", "hide"],
          [".", "show hidden"],
          ["m", "move shelf"],
          ["/", "filter"],
        ].map(([key, word]) => (
          <span key={key}>
            <b className="font-mono font-normal text-k-ink">{key}</b> {word}
          </span>
        ))}
      </footer>
    </section>
  );
}

function Row({ book, on, pick }: { book: LibraryBook; on: boolean; pick: () => void }) {
  const shown = percent(book);
  const sub = [
    book.author,
    book.status === "reading" && shown !== null ? `${shown}%` : null,
    book.status === "reading" ? null : STATUS_WORDS[book.status].toLowerCase(),
  ].filter(Boolean);
  return (
    <button
      type="button"
      role="option"
      aria-selected={on}
      tabIndex={-1}
      onClick={pick}
      className={`flex w-full items-center gap-3 px-4 py-1.5 text-left pointer-coarse:min-h-11 ${
        on ? "bg-k-accent-wash" : ""
      } ${book.hidden ? "opacity-60" : ""}`}
    >
      <Cover book={book} size="small" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-k-13 font-medium">{book.title}</span>
        <span className="truncate text-k-12 text-k-muted">{sub.join(" · ")}</span>
      </span>
    </button>
  );
}
