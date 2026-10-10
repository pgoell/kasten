import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { fetchNote, fetchTodos, searchNotes } from "@/lib/api";
import { noteName } from "@/lib/note-path";
import { LABEL, ROW } from "@/lib/overlay-styles";
import {
  type Done,
  isPerson,
  type Meeting,
  meetings,
  type PersonTodo,
  personDone,
  personTodos,
} from "@/lib/person";
import { PRIORITY_SYMBOL, STATE_SYMBOL } from "@/lib/todo";
import { plainLinks } from "@/lib/wikilink";

interface PersonCardProps {
  /** Vault path of the person note this is about. */
  person: string;
  /** Every path in the vault, which is what turns a link's name into a path. */
  paths?: string[];
  /** Whether the archive is in the answer, which the route holds and one key flips. */
  archive?: boolean;
  /** Called with the note to open and the line the row names. */
  onOpen: (path: string, line: number) => void;
}

/** Meetings on the card. Three is what the vault can say about someone without
 * the card becoming their whole history. */
const MEETINGS = 3;

/** Done lines on the card, a week's worth of finishing on a busy person. */
const DONE = 5;

const HEADING = `${LABEL} px-3 pt-2 pb-1`;

/** A row of the card. A finger needs 44px to land on, and a row that tall
 * centres its one line rather than hanging it from the top. */
const CARD_ROW = `${ROW} flex items-center gap-3 hover:bg-one-hover pointer-coarse:min-h-11`;

/**
 * What the vault knows about one person, gathered onto a card.
 *
 * Two questions of the vault and no new endpoint: every open todo, which the
 * todo pane asks for anyway, and every line carrying the person's name, which
 * is what the backlinks panel asks for. Both share their query key with the
 * panel that asked first, so opening a card next to the todo pane costs one
 * scan rather than two, and `lib/person.ts` does the reading.
 *
 * Drawn in two places, the pane behind `<leader>gp` and the foot of the person's
 * own note, which is why it takes the paths and the archive rather than reading
 * them from somewhere: neither is a thing a card should know how to find.
 */
export function PersonCard({ person, paths, archive = false, onOpen }: PersonCardProps) {
  const name = noteName(person);

  // The todo pane's own key, so the two read one answer.
  const todos = useQuery({
    queryKey: ["todos", archive],
    queryFn: () => fetchTodos(archive),
    retry: false,
  });

  // The backlinks panel's own key, and its own question: every line in the
  // vault carrying the person's name, links and prose alike. Which of them are
  // really links is decided here, the way the panel decides it.
  const lines = useQuery({
    queryKey: ["search", name, archive],
    queryFn: () => searchNotes(name, archive),
    retry: false,
  });

  const open = useMemo(
    () => personTodos(todos.data ?? [], person, paths ?? []),
    [todos.data, person, paths],
  );
  const met = useMemo(
    () => meetings(lines.data ?? [], person, paths ?? [], MEETINGS),
    [lines.data, person, paths],
  );
  const done = useMemo(
    () => personDone(lines.data ?? [], person, paths ?? [], DONE),
    [lines.data, person, paths],
  );

  const empty = open.length === 0 && met.length === 0 && done.length === 0;
  const reading = todos.isPending || lines.isPending;

  function drawTodo({ hit, todo }: PersonTodo) {
    return (
      <button
        key={`${hit.path}:${hit.line}`}
        type="button"
        onClick={() => onOpen(hit.path, hit.line)}
        className={CARD_ROW}
      >
        <span className="shrink-0 text-one-muted">{STATE_SYMBOL[todo.state]}</span>
        <span className="min-w-0 flex-1 truncate text-one-fg">{plainLinks(todo.text)}</span>
        {/* Out of the truncation, so a long todo loses its words rather than
            the date they are due on. */}
        {todo.priority !== undefined && (
          <span className="shrink-0">{PRIORITY_SYMBOL[todo.priority]}</span>
        )}
        {todo.due !== undefined && <span className="shrink-0 text-one-muted">📅 {todo.due}</span>}
      </button>
    );
  }

  function drawMeeting(meeting: Meeting) {
    return (
      <button
        key={meeting.path}
        type="button"
        onClick={() => onOpen(meeting.path, meeting.line)}
        className={CARD_ROW}
      >
        <span className="shrink-0 text-one-muted">{meeting.date}</span>
        <span className="min-w-0 flex-1 truncate text-one-fg">
          {/* The date opens the filename and the row already carries it. */}
          {noteName(meeting.path).slice(meeting.date.length + 1)}
        </span>
      </button>
    );
  }

  function drawDone({ hit, date, text }: Done) {
    return (
      <button
        key={`${hit.path}:${hit.line}`}
        type="button"
        onClick={() => onOpen(hit.path, hit.line)}
        className={CARD_ROW}
      >
        <span className="shrink-0 text-one-muted">{date}</span>
        <span className="min-w-0 flex-1 truncate text-one-fg">{plainLinks(text)}</span>
      </button>
    );
  }

  return (
    <div className="h-full overflow-auto font-mono text-[13px]">
      {open.length > 0 && (
        <section aria-label="Open todos">
          <h2 className={HEADING}>open todos</h2>
          {open.map(drawTodo)}
        </section>
      )}

      {met.length > 0 && (
        <section aria-label="Last meetings">
          <h2 className={HEADING}>last meetings</h2>
          {met.map(drawMeeting)}
        </section>
      )}

      {done.length > 0 && (
        <section aria-label="Recently done">
          <h2 className={HEADING}>recently done</h2>
          {done.map(drawDone)}
        </section>
      )}

      {/* A card with nothing on it says which of the two it is. Nothing linking
          the person is the ordinary state of a name nobody has written in a
          todo yet, and saying how the card fills is more use than saying it is
          empty. */}
      {empty && (
        <p className="px-3 py-2 text-one-muted">
          {reading
            ? "reading the vault"
            : `nothing links [[${name}]] yet. Write the link into a todo and it shows here.`}
        </p>
      )}
    </div>
  );
}

interface PersonFooterProps {
  /** The note open in this pane, which is a person's or is not. */
  path: string;
  paths?: string[];
  archive?: boolean;
  onOpen: (path: string, line: number) => void;
}

/**
 * The card under the note it is about, and nothing at all under any other note.
 *
 * It asks for the note itself rather than being told what kind of note it is,
 * because the answer is in the frontmatter and the editor above has already
 * fetched it: this reads the same cache entry and costs no request. Which is
 * also why the type can change under it. Write `type: Person` into a note and
 * the card appears when the autosave lands, with nothing to press.
 */
export function PersonFooter({ path, paths, archive, onOpen }: PersonFooterProps) {
  const note = useQuery({ queryKey: ["note", path], queryFn: () => fetchNote(path), retry: false });

  if (note.data === undefined || !isPerson(note.data)) return null;

  return (
    // A share of the pane rather than the content's own height: a person with
    // eleven open todos should not push the note they are about off the screen.
    <div className="h-[min(14rem,40%)] shrink-0 border-t border-one-line">
      <PersonCard person={path} paths={paths} archive={archive} onOpen={onOpen} />
    </div>
  );
}
