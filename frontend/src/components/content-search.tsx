import {
  type CSSProperties,
  Fragment,
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { SearchFilters } from "@/components/search-filters";
import { SearchHistogram } from "@/components/search-histogram";
import type { SearchHit } from "@/lib/api";
import { noteName } from "@/lib/note-path";
import { BACKDROP, closeOnBackdrop, ROW, STATUS, TAP } from "@/lib/overlay-styles";
import { type Filters, facets, filterHits, termRuns } from "@/lib/search-facets";
import { lastWeeks, linesPerWeek, type WeekKey, weekOf, weekRange } from "@/lib/search-weeks";
import { useEntrance } from "@/lib/stagger";
import { isMention, useSearchHits } from "@/lib/use-search-hits";
import { useViewport } from "@/lib/use-viewport";

/** Rows the list keeps. More than the lists beside it, because a search is read rather than scanned. */
const ROWS = 60;

/** The week a line was written in, or nothing for a line with no date. */
function weekOfHit(hit: SearchHit): WeekKey | undefined {
  return weekOf(hit.date ?? "");
}

/** Whether a line is in the chosen folder and tag, and in the chosen week when there is one. */
function kept(hit: SearchHit, filters: Filters, week: WeekKey | undefined): boolean {
  return filterHits([hit], filters).length === 1 && (week === undefined || weekOfHit(hit) === week);
}

/** Tapping does not take the focus from the input: the keys have to keep working after it. */
const keepFocus = (event: MouseEvent) => event.preventDefault();

/**
 * The term's runs of a line, each with the offset it starts at. The offset is
 * the key: two runs can carry the same words, but never the same place.
 */
function runsAt(
  text: string,
  term: string,
): (ReturnType<typeof termRuns>[number] & { start: number })[] {
  let start = 0;
  return termRuns(text, term).map((run) => {
    const at = start;
    start += run.text.length;
    return { ...run, start: at };
  });
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** One line of a note: its number in mono, and the line with the term in the accent. */
function LineRow({
  id,
  line,
  text,
  term,
  selected,
  onOpen,
}: {
  id: string;
  line: number;
  text: string;
  term: string;
  selected: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      id={id}
      type="button"
      role="option"
      aria-selected={selected}
      // Out of the tab order, as the other lists are: the input keeps the focus.
      tabIndex={-1}
      onMouseDown={keepFocus}
      onClick={onOpen}
      className={`${ROW} ${TAP} flex gap-3 ${selected ? "bg-k-surface" : ""}`}
    >
      <span className="w-10 shrink-0 pt-px text-right font-mono text-k-12 text-k-muted">
        {line}
      </span>
      <span className="min-w-0 flex-1 break-words font-sans text-k-ink">
        {runsAt(text, term).map((run) => (
          <Fragment key={run.start}>
            {run.term ? <span className="font-medium text-k-accent">{run.text}</span> : run.text}
          </Fragment>
        ))}
      </span>
    </button>
  );
}

interface ContentSearchProps {
  /** Called with the note to open and the line the match sits on. */
  onOpen: (path: string, line: number) => void;
  onClose: () => void;
  /** Whether the archive is in the answer, which the route holds. */
  archive: boolean;
  onToggleArchive?: () => void;
  /** The week the results are narrowed to, from the URL. */
  week?: WeekKey;
  /** Set or clear that week. */
  onWeek?: (week: WeekKey | undefined) => void;
  /** Today, for tests. Read once on mount when absent. */
  now?: Date;
}

/**
 * The search page: a query field over a column of filters, a histogram of the
 * weeks the lines were written in, and the lines grouped by note.
 *
 * The filters and the week narrow the lines and never the numbers that name
 * them. The column and the histogram count the whole answer, less only the
 * choices that do not concern them, so a bar's count is the list it opens.
 */
export function ContentSearch({
  onOpen,
  onClose,
  archive,
  onToggleArchive,
  week,
  onWeek,
  now,
}: ContentSearchProps) {
  const [query, setQuery] = useState("");
  /** Which hit Enter would open. */
  const [active, setActive] = useState(0);
  const [filters, setFilters] = useState<Filters>({ folder: null, tag: null });
  /** Below `md` the column is folded into a button, and this is whether it is open. */
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Read once, so the bars do not shift under a page left open past midnight.
  const [today] = useState(() => now ?? new Date());
  const { narrow } = useViewport();
  const field = useRef<HTMLInputElement>(null);
  /** Set once a line is on its way open, and the focus then belongs to the editor. */
  const opening = useRef(false);
  const listId = useId();
  const typed = query.trim();

  const keep = useCallback((hit: SearchHit) => kept(hit, filters, week), [filters, week]);
  const { found, groups, ordered, pending, archived, capped } = useSearchHits({
    mode: "search",
    typed,
    archive,
    keep,
    visible: ROWS,
  });
  // The notes admitted to the entrance are the ones the first answer named, so
  // a note that turns up under a later query arrives without the animation.
  const entering = useEntrance(pending ? [] : groups.map((group) => group.name ?? ""));

  // Typing puts the highlight back on the first row, and a narrowing list can
  // leave it past the end.
  const cursor = Math.min(active, Math.max(ordered.length - 1, 0));

  // The list scrolls its highlight into view, as the book contents do. Without it
  // a highlight walked past the bottom of the list is one the reader cannot see.
  useEffect(() => {
    document.getElementById(`${listId}-${cursor}`)?.scrollIntoView({ block: "nearest" });
  }, [cursor, listId]);

  // The answer without the mentions it cannot have, which the counts read.
  const answer = useMemo(() => found.filter((hit): hit is SearchHit => !isMention(hit)), [found]);
  const inFolder = useMemo(() => filterHits(answer, filters), [answer, filters]);
  const weeks = useMemo(() => lastWeeks(today), [today]);
  const counts = useMemo(
    () =>
      linesPerWeek(
        inFolder.map((hit) => hit.date),
        weeks,
      ),
    [inFolder, weeks],
  );
  const chosen = useMemo(
    () => (week === undefined ? inFolder : inFolder.filter((hit) => weekOfHit(hit) === week)),
    [inFolder, week],
  );
  const counted = useMemo(() => facets(answer), [answer]);

  // The input takes the focus so the keys reach it, and hands it back on the
  // way out, unless a line is opening: the editor takes the focus only when
  // nobody holds it, and handing it back there would leave a note to click
  // before it can be written in.
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

  /** A folder or a tag: the one chosen clears on a second press, and the other is left alone. */
  function choose(part: "folder" | "tag", value: string) {
    setActive(0);
    setFilters((previous) => ({ ...previous, [part]: previous[part] === value ? null : value }));
  }

  /** A bar: the chosen week clears on a second press. */
  function pickWeek(picked: WeekKey) {
    setActive(0);
    onWeek?.(picked === week ? undefined : picked);
  }

  function onKeyDown(event: KeyboardEvent) {
    // Enter on a focused bar, filter or All weeks button is that button's to
    // press. Left unprevented, the browser clicks it; a result row is the one
    // button Enter should open.
    if (
      event.key === "Enter" &&
      event.target instanceof HTMLButtonElement &&
      event.target.getAttribute("role") !== "option"
    ) {
      return;
    }
    // Tab walks the list rather than completing anything, as it does in the
    // lists beside this one, and Enter opens the row under the highlight.
    const tab = event.key === "Tab";
    const down =
      event.key === "ArrowDown" || (tab && !event.shiftKey) || (event.ctrlKey && event.key === "n");
    const up =
      event.key === "ArrowUp" || (tab && event.shiftKey) || (event.ctrlKey && event.key === "p");

    if (down || up) {
      // Prevented before the empty list is checked: an empty list is where Tab
      // would otherwise leave the panel and not come back.
      event.preventDefault();
      if (ordered.length === 0) return;
      setActive(down ? Math.min(cursor + 1, ordered.length - 1) : Math.max(cursor - 1, 0));
      return;
    }

    switch (event.key) {
      case "Enter":
        event.preventDefault();
        accept(ordered[cursor]);
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

  const summary = `${plural(chosen.length, "line")} in ${plural(new Set(chosen.map((hit) => hit.path)).size, "note")}`;
  const hint = pending
    ? "reading the vault"
    : typed === ""
      ? "type to search every note"
      : answer.length === 0
        ? "no notes match"
        : "";
  const cap = capped ? "Counts are of the first 2,000 lines." : "";

  const column = (
    <SearchFilters
      facets={counted}
      filters={filters}
      archive={archive}
      archived={archived}
      onFolder={(name) => choose("folder", name)}
      onTag={(name) => choose("tag", name)}
      onArchive={() => onToggleArchive?.()}
    />
  );

  return (
    // The dialog reads the keys, not the input, so they still land once a click
    // has moved the focus to a row, a bar or the backdrop.
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search notes"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      {...closeOnBackdrop(onClose)}
      // On a phone the sheet takes the whole screen, so the backdrop's top
      // padding would only push it off the bottom.
      className={`${BACKDROP} max-md:pt-0`}
    >
      <div className="flex max-h-full min-h-0 w-[min(80rem,96vw)] h-[min(56rem,80dvh)] flex-col overflow-hidden rounded-md border border-k-rule bg-k-paper font-sans shadow-xl max-md:h-dvh max-md:w-full max-md:rounded-none">
        <div className="border-b border-k-rule px-6 pt-5 pb-3">
          <label htmlFor={`${listId}-query`} className="sr-only">
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
            placeholder="Search the vault"
            role="combobox"
            aria-expanded={ordered.length > 0}
            aria-controls={listId}
            aria-activedescendant={ordered.length > 0 ? `${listId}-${cursor}` : undefined}
            autoComplete="off"
            spellCheck={false}
            className="w-full bg-transparent font-serif text-k-36 text-k-ink outline-none placeholder:text-k-muted"
          />
        </div>

        <div className="flex min-h-0 flex-1">
          {!narrow && (
            <aside
              aria-label="Filters"
              className="w-[220px] shrink-0 overflow-auto border-r border-k-rule px-3 py-4"
            >
              {column}
            </aside>
          )}

          <div className="flex min-w-0 flex-1 flex-col">
            {narrow && (
              <div className="border-b border-k-rule px-4 py-2">
                <button
                  type="button"
                  aria-expanded={filtersOpen}
                  onMouseDown={keepFocus}
                  onClick={() => setFiltersOpen((open) => !open)}
                  className={`${TAP} cursor-pointer text-[13px] text-k-accent`}
                >
                  Filters
                </button>
                {filtersOpen && <div className="pt-2">{column}</div>}
              </div>
            )}

            <div className="px-4 pt-4">
              <SearchHistogram weeks={weeks} counts={counts} week={week} onPick={pickWeek} />
            </div>

            {(typed !== "" || week !== undefined) && (
              <p className="flex flex-wrap items-baseline gap-x-3 px-4 pt-3 font-sans text-[13px] text-k-ink">
                <span>
                  {summary}
                  {week === undefined ? "." : ` written ${weekRange(week)}.`}
                </span>
                {week !== undefined && (
                  <button
                    type="button"
                    onMouseDown={keepFocus}
                    onClick={() => onWeek?.(undefined)}
                    className={`${TAP} cursor-pointer text-[13px] text-k-accent underline`}
                  >
                    All weeks
                  </button>
                )}
              </p>
            )}

            <div className="min-h-0 flex-1 overflow-auto py-2">
              {ordered.length > 0 && (
                // A div rather than a list, as in the lists beside this one.
                <div id={listId} role="listbox" aria-label="Matching lines">
                  {groups.map((group, at) => {
                    const note = group.name ?? "";
                    return (
                      // biome-ignore lint/a11y/useSemanticElements: a <fieldset> groups form controls, and these are the options of a listbox.
                      <div
                        key={note}
                        role="group"
                        aria-label={note}
                        className={`px-4 pb-2 ${entering(note) ? "k-enter" : ""}`}
                        style={{ "--i": at } as CSSProperties}
                      >
                        <div className="px-2 pt-3">
                          <div className="font-serif text-k-19 text-k-ink">{noteName(note)}</div>
                          <div className="font-mono text-k-12 text-k-muted">{note}</div>
                        </div>
                        {group.rows.map((index) => {
                          const hit = found[index];
                          if (hit === undefined) return null;
                          const row = ordered.indexOf(index);
                          return (
                            <LineRow
                              key={`${hit.path}:${hit.line}`}
                              id={`${listId}-${row}`}
                              line={hit.line}
                              text={hit.text}
                              term={typed}
                              selected={row === cursor}
                              onOpen={() => accept(index)}
                            />
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* An <output> rather than a <p role="status">: same announcement, and
                the element carries it without the attribute. */}
            <output className={STATUS}>
              {[hint, cap].filter((text) => text !== "").join(" ")}
            </output>
          </div>
        </div>
      </div>
    </div>
  );
}
