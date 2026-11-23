/**
 * A note's own ways to a store todo: Tab at the end of a checkbox line makes the line a todo,
 * and `[[todo` picks one that exists. Either leaves `![[kt-…]]` where the todo sits.
 */

import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import type { TodoRow } from "@/lib/core/api";
import { embedSource } from "@/lib/notes/embeds/embed";
import { notePath } from "@/lib/todo/todo-commands";

/** `- [ ] words`, open, with words and no store id yet. */
const CHECKBOX = /^(\s*)[-*+] \[ \] (?=\S)(.*\S)\s*$/;
/** `[[todo` and what is typed after it, up to the cursor. */
const TYPED = /\[\[todo\b[^\]\n]*$/i;

/**
 * Tab with the cursor at the end of an open checkbox line: the store adds the todo to this
 * note, and the line becomes its embed. Declines anywhere else, so Tab still indents.
 */
export function makeTodoOnTab(view: EditorView): boolean {
  const { state } = view;
  const source = state.facet(embedSource);
  const path = state.facet(notePath);
  const { main } = state.selection;
  const line = state.doc.lineAt(main.head);
  const found = CHECKBOX.exec(line.text);
  if (!main.empty || main.head !== line.to || found === null || !source?.addTodo || !path)
    return false;
  const typed = line.text;
  void source.addTodo(path, typed.trim()).then((id) => {
    // Found again by its text: typing may have moved it while the store answered.
    const now = view.state.doc;
    for (let at = 1; at <= now.lines; at++) {
      const each = now.line(at);
      if (each.text !== typed) continue;
      view.dispatch({ changes: { from: each.from, to: each.to, insert: `${found[1]}![[${id}]]` } });
      return;
    }
  });
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
