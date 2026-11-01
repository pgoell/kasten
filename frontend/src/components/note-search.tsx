import { Fragment, useEffect, useId, useRef, useState } from "react";
import { ContentSearch } from "@/components/content-search";
import { SearchPreview } from "@/components/search-preview";
import { SearchRow } from "@/components/search-row";
import type { Mention, SearchHit } from "@/lib/api";
import {
  BACKDROP,
  BODY,
  closeOnBackdrop,
  HEADER_ROW,
  INPUT,
  LABEL,
  LIST,
  PANEL,
  PANEL_WIDE,
  STATUS,
} from "@/lib/overlay-styles";
import { isMention, type SearchMode, useSearchHits } from "@/lib/use-search-hits";

interface NoteSearchProps {
  /** Called with the note to open and the line the match sits on. */
  /** `hit` is the search hit Enter took, whose `place` says where in a file it is. */
  onOpen: (path: string, line: number, hit?: SearchHit) => void;
  onClose: () => void;
  /**
   * The note to show what links to, instead of searching what is typed.
   * Only the source of the lines differs, so this is a mode, not an overlay.
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
  /**
   * Turn an unlinked mention into a `[[link]]`, answering null once it is
   * written or the reason it was not. The route owns the write, being the one
   * that knows which note somebody is typing in.
   */
  onLink?: (mention: Mention) => Promise<string | null>;
  /** Search only: flip the archive in or out, the same switch as `<leader>a`. */
  onToggleArchive?: () => void;
  /** Search only: the ISO week the histogram narrows the lines to, from the URL. */
  week?: string;
  /** Search only: set or clear that week. */
  onWeek?: (week: string | undefined) => void;
  /** Search only: today, for tests. Read once on mount when absent. */
  now?: Date;
}

/** The word over the input, and the name a screen reader reads the dialog by. */
const LABEL_OF: Record<SearchMode, { input: string; dialog: string }> = {
  search: { input: "search notes", dialog: "Search notes" },
  backlinks: { input: "backlinks", dialog: "Backlinks" },
  todos: { input: "todos", dialog: "Todos" },
};

/** React key for the untyped group. A relation name is `[a-z][a-z-]*`, so this is not one. */
const UNTYPED_KEY = "\u0000";

/**
 * What the line under the list says. A scan still running is not "no matches".
 */
function hint(pending: boolean, matches: number, mode: SearchMode): string {
  if (pending) return "reading the vault";
  if (mode === "todos") return matches === 0 ? "no open todos" : "";
  if (mode === "backlinks") return matches === 0 ? "nothing links here" : "";
  return "";
}

/**
 * Tab walks the list rather than completing anything, the way it does in a terminal
 * fuzzy finder: 1 down, -1 up, 0 for a key that is not a move.
 */
function step(event: React.KeyboardEvent): number {
  const tab = event.key === "Tab";
  if (event.key === "ArrowDown" || (tab && !event.shiftKey) || (event.ctrlKey && event.key === "n"))
    return 1;
  if (event.key === "ArrowUp" || (tab && event.shiftKey) || (event.ctrlKey && event.key === "p"))
    return -1;
  return 0;
}

/**
 * Type a few words, and Enter opens the note on the line they are on. The backend
 * finds the lines holding the query literally, and this side only ranks them, so
 * typing narrows while the scan runs. A fuzzy match over prose would read into
 * most of a vault, so it orders the lines and never picks them.
 */
export function NoteSearch(props: NoteSearchProps) {
  if (props.todos !== true && props.backlinksOf === undefined) {
    return (
      <ContentSearch
        onOpen={props.onOpen}
        onClose={props.onClose}
        archive={props.archive ?? false}
        onToggleArchive={props.onToggleArchive}
        week={props.week}
        onWeek={props.onWeek}
        now={props.now}
      />
    );
  }
  return <LineSearch {...props} />;
}

/** The lines of a backlinks or todos list: the ranked panel the search page does not use. */
function LineSearch({
  onOpen,
  onClose,
  backlinksOf,
  paths,
  todos,
  archive = false,
  onLink,
}: NoteSearchProps) {
  const [query, setQuery] = useState("");
  /** Which hit Enter would open. */
  const [active, setActive] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  /** Set once a note is on its way open, and the focus then belongs to the editor. */
  const opening = useRef(false);
  const listId = useId();

  const mode: SearchMode =
    todos === true ? "todos" : backlinksOf === undefined ? "search" : "backlinks";

  const typed = query.trim();
  const { found, groups, ordered, pending } = useSearchHits({
    mode,
    typed,
    backlinksOf,
    paths,
    archive,
  });

  // Typing puts the highlight back on the first row, and a narrowing list can
  // leave it past the end.
  const cursor = Math.min(active, Math.max(ordered.length - 1, 0));
  const highlighted = ordered[cursor];
  const highlightedHit = highlighted === undefined ? undefined : found[highlighted];

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

  /** Why the last link was not written, which the line under the list says. */
  const [refused, setRefused] = useState<string>();
  /**
   * The mentions whose write is in the air. A second press while one is out
   * would read the note before the first lands and link the same words twice,
   * or be refused over a base the first just moved.
   */
  const linking = useRef(new Set<string>());

  async function link(index: number | undefined) {
    if (index === undefined || onLink === undefined) return;
    const hit = found[index];
    if (hit === undefined || !isMention(hit)) return;
    const key = `${hit.path}:${hit.line}:${hit.start}`;
    if (linking.current.has(key)) return;
    linking.current.add(key);
    setRefused(undefined);
    try {
      const reason = await onLink(hit);
      if (reason !== null) setRefused(reason);
    } finally {
      linking.current.delete(key);
    }
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const move = step(event);
    if (move !== 0) {
      // Without this the arrows take the caret to one end of the input, which
      // is where the browser sends them when nothing else does, and Tab takes
      // the focus out of the panel. Prevented before the empty list is checked,
      // because an empty list is where Tab would leave and not come back.
      event.preventDefault();
      if (ordered.length === 0) return;
      setActive(Math.min(Math.max(cursor + move, 0), ordered.length - 1));
      return;
    }

    switch (event.key) {
      case "Enter":
        event.preventDefault();
        // Ctrl or Cmd with Enter links an unlinked mention where Enter alone
        // opens it, the panel's own key the way Tab is, and on any other row
        // it does nothing rather than open by surprise.
        if (event.ctrlKey || event.metaKey) void link(highlighted);
        else accept(highlighted);
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
    return (
      <SearchRow
        // Keyed on the offset as well, since one line can name the note twice.
        key={isMention(hit) ? `${hit.path}:${hit.line}:${hit.start}` : `${hit.path}:${hit.line}`}
        hit={hit}
        optionId={`${listId}-${row}`}
        selected={row === cursor}
        todos={mode === "todos"}
        onOpen={() => accept(index)}
        onLink={() => void link(index)}
      />
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
      {...closeOnBackdrop(onClose)}
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
              // A reason for a link is about the rows it was given for.
              setRefused(undefined);
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

          <SearchPreview hit={highlightedHit} />
        </div>

        {/* An <output> rather than a <p role="status">: same announcement, and
            the element carries it without the attribute. */}
        {/* Backlinks count only the rows that link, so a note named in prose
            and linked nowhere still says nothing links here. */}
        <output className={STATUS}>
          {refused ??
            hint(
              pending,
              ordered.filter((index) => {
                const hit = found[index];
                return hit !== undefined && !isMention(hit);
              }).length,
              mode,
            )}
        </output>
      </div>
    </div>
  );
}
