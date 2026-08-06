import { keepPreviousData, skipToken, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { searchNotes } from "@/lib/api";
import { lineCandidates, rankIndexes } from "@/lib/fuzzy";

interface NoteSearchProps {
  /** Called with the note to open and the line the match sits on. */
  onOpen: (path: string, line: number) => void;
  onClose: () => void;
}

/** Rows the list will mount. Beyond this, another letter narrows faster than a scroll. */
const VISIBLE_HITS = 20;

/**
 * How long typing holds still before the vault is read.
 *
 * Unlike the finder, every query here is a scan of the whole vault, so a
 * keystroke that fired its own would be ten scans for a word nobody finished
 * typing. Short enough that finishing a word and finding it read as one thing.
 */
const SETTLE_MS = 120;

/**
 * What the line under the list says, and nothing where it has nothing to say.
 *
 * Nothing typed is not the same as nothing found, and neither is a scan still
 * running. Saying "no notes match" while the answer is on its way is the lie
 * worth going to this length to avoid.
 */
function hint(typed: string, pending: boolean, matches: number): string {
  if (!typed) return "type to search every note";
  if (pending) return "reading the vault";
  return matches === 0 ? "no notes match" : "";
}

/**
 * Type a few words, and Enter opens the note on the line they are on.
 *
 * Two stages, and the split is the whole design. The backend finds the lines
 * holding the query literally, which is the part a browser cannot do without
 * every note in it. This side ranks what came back, which is the part that has
 * to answer per keystroke. A subsequence match is what makes the finder feel
 * fuzzy over note names, and it means nothing over prose: it reads into most
 * of a vault whatever you type. So it never chooses the lines here, only their
 * order, and a literal match chooses which lines it is given.
 *
 * That split is also why typing narrows without waiting. The lines in hand are
 * ranked against the live query while the scan for it is still running, so the
 * list keeps tightening between answers rather than freezing until the next.
 */
export function NoteSearch({ onOpen, onClose }: NoteSearchProps) {
  const [query, setQuery] = useState("");
  /** What the vault was last asked for, which trails what has been typed. */
  const [asked, setAsked] = useState("");
  /** Which hit Enter would open. */
  const [active, setActive] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  /** Set once a note is on its way open, and the focus then belongs to the editor. */
  const opening = useRef(false);
  const listId = useId();

  const typed = query.trim();

  useEffect(() => {
    const timer = setTimeout(() => setAsked(typed), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [typed]);

  const search = useQuery({
    queryKey: ["search", asked],
    queryFn: asked === "" ? skipToken : () => searchNotes(asked),
    // What keeps the last answer on screen while the next one is fetched, and
    // so what there is to narrow in the meantime.
    placeholderData: keepPreviousData,
    // A scan nobody asked to repeat is not worth three attempts and a backoff.
    retry: false,
  });

  const found = useMemo(() => search.data ?? [], [search.data]);
  // Derived from the answer and not from the query, so every keystroke between
  // two answers ranks a set that was prepared once.
  const candidates = useMemo(() => lineCandidates(found.map((hit) => hit.text)), [found]);
  // Ranked against what is typed now rather than what was asked for, which is
  // what narrows the list while the next scan is still out. Ranked whole and
  // cut afterwards, so the rows are the best of the answer and not its head.
  const hits = useMemo(
    () => rankIndexes(candidates, typed).slice(0, VISIBLE_HITS),
    [candidates, typed],
  );
  // Typing puts the highlight back on the first row, and a narrowing list can
  // leave it past the end.
  const cursor = Math.min(active, Math.max(hits.length - 1, 0));
  const highlighted = hits[cursor];

  // The input takes the focus so the keys reach it, and hands it back on the
  // way out, unless a note is opening: the editor behind takes the focus only
  // when nobody holds it, and handing it back there leaves a note you have to
  // click before you can write in it.
  useEffect(() => {
    const opener = document.activeElement;
    field.current?.focus();
    return () => {
      if (opening.current) return;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  function accept(index: number | undefined) {
    if (index === undefined) return;
    const hit = found[index];
    if (hit === undefined) return;
    opening.current = true;
    onOpen(hit.path, hit.line);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const down = event.key === "ArrowDown" || (event.ctrlKey && event.key === "n");
    const up = event.key === "ArrowUp" || (event.ctrlKey && event.key === "p");

    if (down || up) {
      if (hits.length === 0) return;
      // Without this the arrows take the caret to one end of the input, which
      // is where the browser sends them when nothing else does.
      event.preventDefault();
      setActive(down ? Math.min(cursor + 1, hits.length - 1) : Math.max(cursor - 1, 0));
      return;
    }

    switch (event.key) {
      case "Enter":
        event.preventDefault();
        accept(highlighted);
        break;
      case "Escape":
        event.preventDefault();
        onClose();
        break;
      default:
        // Everything else is typing, and belongs to the input.
        return;
    }
  }

  return (
    // The dialog reads the keys, not the input, so they still land once a click
    // has moved the focus to a row or to the backdrop.
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search notes"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-20 flex items-start justify-center bg-black/50 pt-[15vh] focus:outline-none"
    >
      <div className="flex w-[min(56rem,92vw)] flex-col rounded-md border border-one-line bg-one-panel font-mono shadow-xl">
        <div className="flex items-center gap-3 border-b border-one-line px-3 py-2">
          <label
            htmlFor={`${listId}-query`}
            className="text-[11px] tracking-wider text-one-muted uppercase"
          >
            search notes
          </label>
          <input
            id={`${listId}-query`}
            ref={field}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            role="combobox"
            aria-expanded={hits.length > 0}
            aria-controls={listId}
            aria-activedescendant={hits.length > 0 ? `${listId}-${cursor}` : undefined}
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-one-fg outline-none"
          />
        </div>

        {/* A fixed height rather than one the content sets, so the panel does
            not jump about as the list narrows under it. */}
        <div className="h-[min(26rem,55vh)] overflow-auto py-1">
          {hits.length > 0 && (
            // A div rather than a list, because a listbox is not a list of
            // items to a screen reader and marking it as both says it twice.
            <div id={listId} role="listbox" aria-label="Matching lines">
              {hits.map((index, row) => {
                const hit = found[index];
                if (hit === undefined) return null;
                return (
                  <button
                    key={`${hit.path}:${hit.line}`}
                    id={`${listId}-${row}`}
                    type="button"
                    role="option"
                    aria-selected={row === cursor}
                    // Out of the tab order: the focus stays in the input, and
                    // the highlight is how the list says what Enter would open.
                    tabIndex={-1}
                    onClick={() => accept(index)}
                    className={`flex w-full cursor-pointer gap-3 px-3 py-[3px] text-left text-[13px] ${
                      row === cursor ? "bg-one-hover" : ""
                    }`}
                  >
                    <span
                      className={`shrink-0 truncate ${row === cursor ? "text-one-accent" : "text-one-muted"}`}
                    >
                      {hit.path}:{hit.line}
                    </span>
                    {/* The line itself never wraps: one row per hit is what
                        makes the list countable at a glance. */}
                    <span className="min-w-0 flex-1 truncate text-one-fg">{hit.text}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* An <output> rather than a <p role="status">: same announcement, and
            the element carries it without the attribute. */}
        <output className="border-t border-one-line px-3 py-1 text-[11px] text-one-muted">
          {hint(typed, search.isFetching, hits.length)}
        </output>
      </div>
    </div>
  );
}
