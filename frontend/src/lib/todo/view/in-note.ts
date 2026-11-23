/**
 * A note's own ways to a store todo: Tab at the end of a checkbox line makes the line a todo,
 * and `[[todo` picks one that exists. Either leaves `![[kt-…]]` where the todo sits.
 */

import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { StateEffect, StateField } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { TodoRow } from "@/lib/core/api";
import { embedSource } from "@/lib/notes/embeds/embed";
import { noticeSource } from "@/lib/notes/embeds/image";
import { notePath } from "@/lib/todo/todo-commands";

/** `- [ ] words`, open, with words and no store id yet; a trailing `^block` id kept apart. */
const CHECKBOX = /^(\s*)[-*+] \[ \] (?=\S)(.*?\S)(\s\^[\w-]+)?\s*$/;
/** `[[todo` and what is typed after it, up to the cursor. */
const TYPED = /\[\[todo\b[^\]\n]*$/i;

interface Making {
  key: number;
  /** The start of the line, mapped through every edit while the store answers. */
  at: number;
}

const making = StateEffect.define<{ key: number; at?: number }>({
  map: (value, changes) =>
    value.at === undefined ? value : { ...value, at: changes.mapPos(value.at) },
});

/** The checkbox lines Tab has sent to the store and not yet swapped for their embed. */
export const makingTodos = StateField.define<readonly Making[]>({
  create: () => [],
  update(value, tr) {
    let next = tr.docChanged
      ? value.map((each) => ({ ...each, at: tr.changes.mapPos(each.at) }))
      : value;
    for (const effect of tr.effects) {
      if (!effect.is(making)) continue;
      const { key, at } = effect.value;
      next = at === undefined ? next.filter((each) => each.key !== key) : [...next, { key, at }];
    }
    return next;
  },
});

let nextKey = 0;

/**
 * Tab with the cursor at the end of an open checkbox line: the store adds the todo to this
 * note, and the line becomes its embed. Declines anywhere else, so Tab still indents.
 */
export function makeTodoOnTab(view: EditorView): boolean {
  const { state } = view;
  const source = state.facet(embedSource);
  const path = state.facet(notePath);
  const inFlight = state.field(makingTodos, false);
  const { main } = state.selection;
  const line = state.doc.lineAt(main.head);
  const found = CHECKBOX.exec(line.text);
  if (!main.empty || main.head !== line.to || found === null || !source?.addTodo || !path)
    return false;
  if (inFlight === undefined) return false;
  // A second Tab while the store answers would make a second todo.
  if (inFlight.some((each) => state.doc.lineAt(each.at).number === line.number)) return true;
  const key = nextKey++;
  const typed = line.text;
  const [, indent = "", , block = ""] = found;
  const notice = state.facet(noticeSource)();
  view.dispatch({ effects: making.of({ key, at: line.from }) });
  source.addTodo(path, `- [ ] ${found[2]}`).then(
    (id) => {
      const at = view.state.field(makingTodos).find((each) => each.key === key)?.at;
      const done = making.of({ key });
      if (at === undefined) return view.dispatch({ effects: done });
      const now = view.state.doc.lineAt(at);
      // An edited line stays as typed and gets the embed under it, so the todo is never lost.
      const changes =
        now.text === typed
          ? { from: now.from, to: now.to, insert: `${indent}![[${id}]]${block}` }
          : { from: now.to, insert: `\n${indent}![[${id}]]` };
      view.dispatch({ changes, effects: done });
    },
    (error: unknown) => {
      view.dispatch({ effects: making.of({ key }) });
      notice?.(`Not made a todo: ${error instanceof Error ? error.message : String(error)}`);
    },
  );
  return true;
}

/** Open todos first, then by how recently they were touched. */
function order(a: TodoRow, b: TodoRow): number {
  const closed = (row: TodoRow) => (row.state === "done" || row.state === "rejected" ? 1 : 0);
  return closed(a) - closed(b) || b.updated.localeCompare(a.updated);
}

function optionOf(row: TodoRow, from: number): Completion {
  return {
    label: row.words,
    detail: row.state === "open" ? undefined : row.state,
    type: "todo",
    boost: 10,
    apply: (view, _completion, _from, to) =>
      view.dispatch({ changes: { from, to, insert: `![[${row.id}]]` } }),
  };
}

/** `[[todo offer`: the todos whose words hold what is typed, each put in as its embed. */
export function todoLinkCompletions(context: CompletionContext): CompletionResult | null {
  const todos = context.state.facet(embedSource)?.todos?.();
  if (todos === undefined) return null;
  const open = context.matchBefore(TYPED);
  if (open === null) return null;
  const query = open.text.slice("[[todo".length);
  const start = open.from + "[[todo".length + (query.length - query.trimStart().length);
  // The brackets go too, and a closing pair close-brackets may have typed after the cursor.
  const tail = context.state.sliceDoc(context.pos, context.pos + 2) === "]]" ? 2 : 0;
  return {
    from: start,
    to: context.pos + tail,
    options: todos
      .filter((row) => row.round_of === null)
      .sort(order)
      .slice(0, 200)
      .map((row) => optionOf(row, open.from)),
    validFor: /^[^\]\n]*$/,
  };
}
