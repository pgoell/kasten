import { keepPreviousData, skipToken, useQuery } from "@tanstack/react-query";
import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import { NotePreview } from "@/components/note-preview";
import { fetchNote, fetchTodos, type SearchHit, searchNotes } from "@/lib/api";
import { lineCandidates, rankIndexes } from "@/lib/fuzzy";
import { noteName } from "@/lib/note-path";
import {
  BACKDROP,
  BODY,
  HEADER_ROW,
  INPUT,
  LABEL,
  LIST,
  PANE,
  PANE_MESSAGE,
  PANEL,
  PANEL_WIDE,
  ROW,
  STATUS,
} from "@/lib/overlay-styles";
import { readRelation } from "@/lib/relation";
import { isOpen, parseTodo, STATE_SYMBOL } from "@/lib/todo";
import { wikiLinkPath, wikiLinkTargets } from "@/lib/wikilink";

interface NoteSearchProps {
  /** Called with the note to open and the line the match sits on. */
  onOpen: (path: string, line: number) => void;
  onClose: () => void;
  /**
   * The note to show what links to, instead of searching what is typed.
   *
   * The same panel either way: a list of lines from the vault, ranked against
   * the input, and Enter opens the note on the line. Only where the lines come
   * from differs, which is why this is a mode of the search rather than a
   * fourth overlay repeating it.
   */
  backlinksOf?: string;
  /** Every path in the vault, which is what turns a link's name into a path. */
  paths?: string[];
  /** Rank every todo in the vault instead of searching, the way backlinks rank. */
  todos?: boolean;
  /**
   * Whether the archive is in the answer, which the route holds and one key
   * flips. In the query key as well as the request, so the two readings are two
   * cached answers rather than one that goes stale on a toggle.
   */
  archive?: boolean;
}

/** Which of the three lists the panel is drawing, and where its lines come from. */
type SearchMode = "search" | "backlinks" | "todos";

/** The word over the input, and the name a screen reader reads the dialog by. */
const LABEL_OF: Record<SearchMode, { input: string; dialog: string }> = {
  search: { input: "search notes", dialog: "Search notes" },
  backlinks: { input: "backlinks", dialog: "Backlinks" },
  todos: { input: "todos", dialog: "Todos" },
};

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
 * How long the highlight holds still before its note is read.
 *
 * A held ctrl+n walks a row per repeat, and every row it passes through would
 * otherwise be a request for a note nobody is looking at.
 */
const PREVIEW_DELAY_MS = 80;

/**
 * How many lines either side of the hit the pane shows.
 *
 * A window rather than the whole note, so a 10,000 line note costs what a
 * short one does. Wider than the pane is tall, so there is room to scroll
 * around the match without there being a note's worth of rows behind it.
 */
const CONTEXT_LINES = 30;

/** The lines around `line`, and the number the first of them carries. */
function windowAround(text: string, line: number): { lines: string[]; from: number } {
  const all = text.split("\n");
  // Lines count from one and arrays from zero, and this is the only place the
  // two meet.
  const at = line - 1;
  const from = Math.max(0, at - CONTEXT_LINES);
  return { lines: all.slice(from, at + CONTEXT_LINES + 1), from };
}

/** The relation name to group a backlink hit under, or null for the untyped group. */
function relationOf(text: string, viewing: string, paths: string[]): string | null {
  const relation = readRelation(text);
  // A line shows in the panel when any wikilink on it resolves here, so
  // `depends-on:: [[A]] because [[B]]` is in B's panel too. Grouping that by
  // the name alone would tell B it is a dependency when the line says A is.
  if (relation === null || wikiLinkPath(relation.target, paths) !== viewing) return null;
  return relation.name;
}

/** React key for the untyped group. A relation name is `[a-z][a-z-]*`, so this is not one. */
const UNTYPED_KEY = "\u0000";

/** One heading and the ranked rows under it. A null name is the untyped group. */
interface Group {
  name: string | null;
  rows: number[];
}

/** The ranked rows in the order they are drawn: each name once, untyped last. */
function groupHits(rows: number[], found: SearchHit[], viewing: string, paths: string[]): Group[] {
  const named = new Map<string, number[]>();
  const untyped: number[] = [];

  for (const row of rows) {
    const hit = found[row];
    const name = hit === undefined ? null : relationOf(hit.text, viewing, paths);
    if (name === null) {
      untyped.push(row);
      continue;
    }
    const under = named.get(name);
    if (under === undefined) named.set(name, [row]);
    else under.push(row);
  }

  // A map keeps insertion order, which here is first appearance in the ranking,
  // and the rows inside each name keep the rank order they arrived in.
  const groups = [...named].map(([name, under]) => ({ name, rows: under }));
  return untyped.length === 0 ? groups : [...groups, { name: null, rows: untyped }];
}

/**
 * What the line under the list says, and nothing where it has nothing to say.
 *
 * Nothing typed is not the same as nothing found, and neither is a scan still
 * running. Saying "no notes match" while the answer is on its way is the lie
 * worth going to this length to avoid.
 *
 * Backlinks and todos skip the first of those: neither query was ever waiting to
 * be typed, so there is no state where nothing has been asked.
 */
function hint(typed: string, pending: boolean, matches: number, mode: SearchMode): string {
  if (pending) return "reading the vault";
  if (mode === "todos") return matches === 0 ? "no open todos" : "";
  if (mode === "backlinks") return matches === 0 ? "nothing links here" : "";
  if (!typed) return "type to search every note";
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
 *
 * `backlinksOf` turns the same panel around: the vault is asked once, for the
 * note's own name, and typing only ranks what came back. That works because the
 * two stages already split this way. What links to a note is a fixed set the
 * vault decides, and the input was never choosing the lines here anyway.
 *
 * `todos` is that mode read once more, off `/api/todos`. What the vault holds
 * to do is a fixed set for the same reason, so there is no debounce here and no
 * scan per keystroke.
 */
export function NoteSearch({
  onOpen,
  onClose,
  backlinksOf,
  paths,
  todos,
  archive = false,
}: NoteSearchProps) {
  const [query, setQuery] = useState("");
  /** What a typed query settled on, which trails what has been typed. */
  const [settled, setSettled] = useState("");
  /** Which hit Enter would open. */
  const [active, setActive] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  /** Set once a note is on its way open, and the focus then belongs to the editor. */
  const opening = useRef(false);
  const listId = useId();

  const mode: SearchMode =
    todos === true ? "todos" : backlinksOf === undefined ? "search" : "backlinks";

  const typed = query.trim();
  // What the vault is asked for. Backlinks ask for the note's name, and ask
  // once: every link to a note carries its name, whether it spelled the path
  // out or not, so the name is the one query no link to it can escape.
  const name = backlinksOf === undefined ? undefined : noteName(backlinksOf);
  const asked = name ?? settled;

  useEffect(() => {
    // Nothing to settle where the query is fixed, and a timer over it would
    // only be a second answer to a question already asked.
    if (mode !== "search") return;
    const timer = setTimeout(() => setSettled(typed), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [typed, mode]);

  const search = useQuery({
    // The todo list shares its key with the pane, so the two read one answer.
    ...(mode === "todos"
      ? { queryKey: ["todos", archive], queryFn: () => fetchTodos(archive) }
      : {
          queryKey: ["search", asked, archive],
          queryFn: asked === "" ? skipToken : () => searchNotes(asked, archive),
        }),
    // What keeps the last answer on screen while the next one is fetched, and
    // so what there is to narrow in the meantime.
    placeholderData: keepPreviousData,
    // A scan nobody asked to repeat is not worth three attempts and a backoff.
    retry: false,
  });

  // Every line the vault answered with, cut to the ones that really are links
  // where backlinks were asked for. rg finds the note's name in prose as
  // readily as in a link, and only reading the line as the editor parses it
  // tells the two apart. Resolving each target against the listing is what
  // keeps `[[borges]]` and `[[reading/borges]]` both counting, and a link to
  // another note of the same name in another folder not counting at all.
  //
  // The todo endpoint matches the shape of a checkbox and nothing else, so the
  // same reading cuts its answer down: a session line is not a todo and a
  // finished one is not work.
  const found = useMemo(() => {
    const hits = search.data ?? [];
    if (mode === "todos") {
      return hits.filter((hit) => {
        const todo = parseTodo(hit.text);
        return todo !== null && isOpen(todo);
      });
    }
    if (backlinksOf === undefined) return hits;
    return hits.filter((hit) =>
      wikiLinkTargets(hit.text).some((target) => wikiLinkPath(target, paths ?? []) === backlinksOf),
    );
  }, [search.data, mode, backlinksOf, paths]);
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
  // Backlinks gather under the relation name pointing here; the other two lists
  // are one group with no name, so their rows come out in the order they were
  // ranked in and nothing on screen moves.
  const groups = useMemo(
    () =>
      mode === "backlinks" && backlinksOf !== undefined
        ? groupHits(hits, found, backlinksOf, paths ?? [])
        : [{ name: null, rows: hits }],
    [mode, backlinksOf, hits, found, paths],
  );
  // The order the rows are drawn in, which is the order everything downstream
  // counts in. The highlight, the preview and Enter all index this one array,
  // so grouping at render alone would point all three at another line.
  const ordered = useMemo(() => groups.flatMap((group) => group.rows), [groups]);
  // Typing puts the highlight back on the first row, and a narrowing list can
  // leave it past the end.
  const cursor = Math.min(active, Math.max(ordered.length - 1, 0));
  const highlighted = ordered[cursor];
  const highlightedHit = highlighted === undefined ? undefined : found[highlighted];

  // The hit the pane is reading for, which trails the highlight rather than
  // following it. The hit itself and not its position, because a fresh answer
  // renumbers the list and a position would then point at another line.
  const [reading, setReading] = useState<SearchHit>();

  useEffect(() => {
    if (highlightedHit === undefined) {
      setReading(undefined);
      return;
    }
    const timer = setTimeout(() => setReading(highlightedHit), PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [highlightedHit]);

  // The key `NoteEditor` reads, on purpose: a note read here is one the editor
  // will not have to fetch when Enter opens it. Keyed on the path alone, so
  // walking between two hits of one note re-centres the pane rather than
  // reading the note again.
  const note = useQuery({
    queryKey: ["note", reading?.path],
    queryFn: reading === undefined ? skipToken : () => fetchNote(reading.path),
    staleTime: 30_000,
    // A preview nobody asked for is not worth three attempts and a backoff.
    retry: false,
  });

  // Worked out here rather than in the markup, which has no room to say what
  // `from` is for. Undefined covers both the note still being read and the
  // note refusing to be read; the pane tells those two apart on its own.
  const context =
    reading !== undefined && note.status === "success"
      ? windowAround(note.data, reading.line)
      : undefined;

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
    // Tab walks the list rather than completing anything, the way it does in a
    // terminal fuzzy finder. There is nothing here to complete: Enter opens the
    // row under the highlight whatever the input says.
    const tab = event.key === "Tab";
    const down =
      event.key === "ArrowDown" || (tab && !event.shiftKey) || (event.ctrlKey && event.key === "n");
    const up =
      event.key === "ArrowUp" || (tab && event.shiftKey) || (event.ctrlKey && event.key === "p");

    if (down || up) {
      // Without this the arrows take the caret to one end of the input, which
      // is where the browser sends them when nothing else does, and Tab takes
      // the focus out of the panel. Prevented before the empty list is checked,
      // because an empty list is where Tab would leave and not come back.
      event.preventDefault();
      if (ordered.length === 0) return;
      setActive(down ? Math.min(cursor + 1, ordered.length - 1) : Math.max(cursor - 1, 0));
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

  /** One row of the list, numbered by where it sits in `ordered`. */
  function drawRow(index: number, row: number) {
    const hit = found[index];
    if (hit === undefined) return null;
    // Null on every mode but todos, and on a todo line the filter above cannot
    // hand back, which is why the row still draws the line it was given rather
    // than nothing at all.
    const todo = mode === "todos" ? parseTodo(hit.text) : null;
    return (
      <button
        key={`${hit.path}:${hit.line}`}
        id={`${listId}-${row}`}
        type="button"
        role="option"
        aria-selected={row === cursor}
        // Out of the tab order: the focus stays in the input, and the highlight
        // is how the list says what Enter would open.
        tabIndex={-1}
        onClick={() => accept(index)}
        className={`${ROW} flex gap-3 ${row === cursor ? "bg-one-hover" : ""}`}
      >
        <span
          className={`shrink-0 truncate ${row === cursor ? "text-one-accent" : "text-one-muted"}`}
        >
          {hit.path}:{hit.line}
        </span>
        {/* The line itself never wraps: one row per hit is what makes the list
            countable at a glance. */}
        <span className="min-w-0 flex-1 truncate text-one-fg">
          {todo === null ? hit.text : `${STATE_SYMBOL[todo.state]} ${todo.text}`}
        </span>
        {/* Out of the truncation, so a long todo loses its words rather than
            the date they are due on. */}
        {todo?.due !== undefined && <span className="shrink-0 text-one-muted">📅 {todo.due}</span>}
      </button>
    );
  }

  return (
    // The dialog reads the keys, not the input, so they still land once a click
    // has moved the focus to a row or to the backdrop.
    <div
      role="dialog"
      aria-modal="true"
      aria-label={LABEL_OF[mode].dialog}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={BACKDROP}
    >
      {/* Wider than the finder's, because a row here carries the path, the
          line number and the line itself, and the pane still needs half. */}
      <div className={`${PANEL} ${PANEL_WIDE}`}>
        <div className={HEADER_ROW}>
          <label htmlFor={`${listId}-query`} className={LABEL}>
            {LABEL_OF[mode].input}
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
            aria-expanded={ordered.length > 0}
            aria-controls={listId}
            aria-activedescendant={ordered.length > 0 ? `${listId}-${cursor}` : undefined}
            autoComplete="off"
            spellCheck={false}
            className={INPUT}
          />
        </div>

        {/* A fixed height rather than one the content sets, so the panel does
            not jump about as the list narrows under it. */}
        <div className={BODY}>
          {ordered.length > 0 && (
            // A div rather than a list, because a listbox is not a list of
            // items to a screen reader and marking it as both says it twice.
            <div id={listId} role="listbox" aria-label="Matching lines" className={LIST}>
              {groups.map((group, at) => {
                // Where this group opens in `ordered`, because a row's number
                // is its place in the whole list and not in its group. A click
                // on the wrong number selects another line.
                const opens = groups
                  .slice(0, at)
                  .reduce((count, before) => count + before.rows.length, 0);
                const drawn = group.rows.map((index, within) => drawRow(index, opens + within));
                // The untyped links go under no heading, which is what says
                // they say nothing, and it leaves search and todos drawing the
                // list they drew before.
                // A name is unique among the groups, so it is the key. The
                // untyped group takes one no name can spell: `untyped` is a legal
                // relation name by rule 9, and a plain word here would collide
                // with the group beside it, leaving React to remount one of the
                // two instead of updating it.
                if (group.name === null) return <Fragment key={UNTYPED_KEY}>{drawn}</Fragment>;
                return (
                  // A group rather than a bare heading between the options: a
                  // listbox names a section this way, and text dropped between
                  // two options is read as neither.
                  // biome-ignore lint/a11y/useSemanticElements: a <fieldset> groups form controls, and these are the options of a listbox.
                  <div key={group.name} role="group" aria-label={group.name}>
                    <div className={`${LABEL} px-3 pt-2`}>{group.name}</div>
                    {drawn}
                  </div>
                );
              })}
            </div>
          )}

          {reading !== undefined && (
            // A labelled <section> rather than a bare <pre>, which takes no
            // label of its own and leaves the pane something a screen reader
            // can reach but not name.
            <section aria-label="Preview" data-testid="preview" className={PANE}>
              {context !== undefined ? (
                // Keyed on the note and the line, so walking to another hit
                // builds a fresh view centred on it rather than leaving this
                // one where it was.
                <NotePreview
                  key={`${reading.path}:${reading.line}`}
                  text={context.lines.join("\n")}
                  firstLine={context.from + 1}
                  markLine={reading.line}
                />
              ) : (
                <p className={PANE_MESSAGE}>
                  {/* An empty note is empty, not still loading, and a spinner
                      that never stops is the worse of the two lies. */}
                  {note.status === "error" ? "could not read this note" : "reading the note"}
                </p>
              )}
            </section>
          )}
        </div>

        {/* An <output> rather than a <p role="status">: same announcement, and
            the element carries it without the attribute. */}
        <output className={STATUS}>{hint(typed, search.isFetching, ordered.length, mode)}</output>
      </div>
    </div>
  );
}
