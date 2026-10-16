/**
 * How the board reads a todo: which column it sits in, which lane, and
 * whether it is a card at all.
 *
 * Pure, as `todo-view.ts` is, so the rules the design settled are tested as
 * functions over strings and the pane only draws what these answer.
 */

import { shiftDay } from "@/lib/clock";
import { endsOfWords, parseTodo, type Todo } from "@/lib/todo";
import { wikiLinkPath, wikiLinkTargets } from "@/lib/wikilink";

export type Column = "open" | "doing" | "waiting" | "blocked" | "done" | "rejected";

/** In the order the board draws them: the walk of the work, then where it ended. */
export const COLUMNS: readonly Column[] = [
  "open",
  "doing",
  "waiting",
  "blocked",
  "done",
  "rejected",
];

export const COLUMN_HEADING: Record<Column, string> = {
  open: "Open",
  doing: "Doing",
  waiting: "Waiting",
  blocked: "Blocked",
  done: "Done",
  rejected: "Rejected",
};

/**
 * The folders whose subfolders are projects.
 *
 * Fixed, as `CLIENT` is, rather than a setting: a vault without them sees
 * every todo in no project, and a rule per vault would have to reach the
 * agents that read the same lines as well as this board. Areas count because
 * client work lives there; resources do not, or every reading list would be a
 * project.
 */
export const PROJECT_ROOTS: readonly string[] = ["02 Projects", "03 Areas"];

/**
 * The one root a link files a todo under. Not areas: a daily todo names people
 * far more often than projects, and the people live in `03 Areas/08 People`.
 */
export const LINK_ROOT = "02 Projects";

/** How far back done and rejected reach, the window `d` shows in the list. */
export const BOARD_DAYS = 7;

/** The project folder a path lies in under one of `roots`, at any depth. */
function projectIn(path: string, roots: readonly string[]): string | null {
  const parts = path.split("/");
  // Root, folder and at least the file: a note directly in a root is in none.
  if (parts.length < 3 || !roots.includes(parts[0] ?? "")) return null;
  return `${parts[0]}/${parts[1]}`;
}

/** "02 Projects/FDE" for any note at any depth inside that folder; null for a note directly in a root, outside the roots, or at the vault root. */
export function folderProject(path: string): string | null {
  return projectIn(path, PROJECT_ROOTS);
}

/**
 * The project a todo belongs to, by the design's rule: the note's folder, else
 * the first link on the line into a project, else the parent's.
 *
 * A link counts only when it lands on a note that is there: a typo would
 * otherwise file the todo under a project nobody made.
 */
export function projectOf(
  path: string,
  todo: Todo,
  paths: string[],
  parentProject: string | null,
): string | null {
  const own = folderProject(path);
  if (own !== null) return own;

  for (const target of wikiLinkTargets(todo.text)) {
    const linked = wikiLinkPath(target, paths);
    if (!paths.includes(linked)) continue;
    const project = projectIn(linked, [LINK_ROOT]);
    if (project !== null) return project;
  }

  return parentProject;
}

/** The tags the board draws its first lanes by, fixed for the reason `CLIENT` is. */
export const KINDS: readonly string[] = ["#client", "#internal", "#private"];

/**
 * The kind of work a todo is: its own tag, else the nearest ancestor's.
 *
 * A part that names no kind is the kind of the work it is part of, as a part
 * already takes `#client` in the list.
 */
export function kindOf(todo: Todo, ancestors: Todo[]): string | null {
  for (const one of [todo, ...ancestors]) {
    const kind = one.tags.find((tag) => KINDS.includes(tag));
    if (kind !== undefined) return kind;
  }
  return null;
}

/**
 * Whether a todo is a card. Open work always is; finished work only for the
 * last `BOARD_DAYS`, by the stamp its state wrote. One with no stamp has no
 * day to measure, and an old line typed by hand is the likely case.
 */
export function onBoard(todo: Todo, today: string): boolean {
  const since = shiftDay(today, -BOARD_DAYS);
  if (todo.state === "done") return todo.done !== undefined && todo.done > since;
  if (todo.state === "rejected") return todo.cancelled !== undefined && todo.cancelled > since;
  return true;
}

/** Which column a todo sits in: its state. */
export function columnOf(todo: Todo): Column {
  return todo.state;
}

/**
 * The projects `p` offers: the folders under `LINK_ROOT` with an `index.md`,
 * which is the note a link to the project names.
 */
export function projectChoices(paths: string[]): { folder: string; name: string; index: string }[] {
  const prefix = `${LINK_ROOT}/`;
  return paths
    .filter((path) => path.startsWith(prefix) && path.split("/").length === 3)
    .filter((path) => path.endsWith("/index.md"))
    .map((index) => {
      const folder = index.slice(0, -"/index.md".length);
      return { folder, name: folder.slice(prefix.length), index };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The line with a link to the project added to its words.
 *
 * Into the words and not at the end of the line: obsidian-tasks reads the
 * fields back from the end, and a link after them would hide the due date.
 * Null when the line is already filed there, so a second press writes nothing.
 */
export function withProjectLink(
  line: string,
  choice: { folder: string; name: string; index: string },
  paths: string[],
): string | null {
  const todo = parseTodo(line);
  if (todo === null) return null;

  const inside = `${choice.folder}/`;
  const filed = wikiLinkTargets(todo.text).some((target) =>
    wikiLinkPath(target, paths).startsWith(inside),
  );
  if (filed) return null;

  const link = `[[${choice.index.slice(0, -".md".length)}|${choice.name}]]`;

  // Inserted into the line rather than rebuilt through `formatTodo`, which
  // would turn a tab indent into a space and un-nest a part, move a block id
  // off the end, and collapse the spacing somebody typed.
  //
  // Each place the words might end, tried in order and kept only when
  // `parseTodo` agrees: a marker whose value does not parse, `📅 friday`, is
  // still words, and the parser is the one judge of that rather than a second
  // copy of its patterns. A space after the link is tried second, for a marker
  // typed hard against the word before it.
  let written = `${line} ${link}`;
  for (const at of endsOfWords(line)) {
    for (const after of ["", " "]) {
      written = `${line.slice(0, at)} ${link}${after}${line.slice(at)}`;
      if (sameButLinked(todo, parseTodo(written), link)) return written;
    }
  }
  return written;
}

/**
 * Whether the line as written reads as the original with the link at the end
 * of its words: every field the same, and the link last in the text but for a
 * block id, which `parseTodo` leaves in the words.
 */
function sameButLinked(before: Todo, after: Todo | null, link: string): boolean {
  if (after === null) return false;
  const { text, tags: _tags, ...fields } = after;
  const { text: was, tags: _was, ...had } = before;
  const at = text.lastIndexOf(link);
  if (at === -1 || !/^(?: \^[\w-]+)?$/.test(text.slice(at + link.length))) return false;
  const rest = `${text.slice(0, at)}${text.slice(at + link.length)}`.replace(/\s+/g, " ").trim();
  return rest === was && JSON.stringify(fields) === JSON.stringify(had);
}

/** What a lane is called: the project's own folder name, or the pile still to sort. */
export function laneName(project: string | null): string {
  return project === null ? "No project" : project.slice(project.lastIndexOf("/") + 1);
}
