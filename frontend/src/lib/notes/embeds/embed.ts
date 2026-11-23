/**
 * `![[note]]`, one note drawn inside another. The widget in `live-preview-embeds.ts` needs a way
 * to read and open the note, and how deep it sits in a chain of embeds.
 */

import { Facet } from "@codemirror/state";
import {
  hashKey,
  type QueryClient,
  QueryObserver,
  type QueryObserverResult,
} from "@tanstack/react-query";
import {
  addTodoLine,
  changeTodoLine,
  cycleStoreTodo,
  fetchNote,
  fetchTodos,
  setTodoState,
  type TodoHit,
  type TodoRow,
} from "@/lib/core/api";
import { readClock } from "@/lib/core/clock";
import { encodePath } from "@/lib/notes/links/note-path";
import { namesAFile } from "@/lib/notes/links/wikilink";
import { newId } from "@/lib/todo/todo";
import { agentPress, listedLines } from "@/lib/todo/todo-agent";
import { opensInFilePane } from "@/lib/vault/file-kind";

/** Hands an embed the text of its note, now and on every later change. */
export interface EmbedSource {
  /**
   * Calls `listener` with the note's text once it is read, null when the vault
   * holds no such note or the read failed, and again each time the text
   * changes. Returns what stops the calls.
   */
  watch(path: string, listener: (text: string | null) => void): () => void;
  /** Opens the note in the focused pane at a 1-based line; a pdf opens at its page. */
  open(path: string, line?: number): void;
  /** Calls `listener` with the todo `![[kt-…]]` names as the todo list reads it, null where unlisted. */
  watchTodo?(id: string, listener: (row: TodoRow | null) => void): () => void;
  /** Walks that todo on in the store. */
  cycleTodo?(id: string): void;
  /** Puts that todo in `state` in the store. */
  setTodoState?(id: string, state: TodoRow["state"]): void;
  /** Toggles `#agent` on that todo in the store; answers why nothing moved, or null. */
  agentTodo?(id: string): string | null;
  /** Every todo listed now, for `[[todo` to pick from. */
  todos?(): TodoRow[];
  /** Adds the todo a typed line says to the note at `note`; answers its id. */
  addTodo?(note: string, line: string): Promise<string>;
}

/**
 * Null by default, which differs from a source that answers null: a view with no vault reader,
 * like the finder's preview, shows the embed as a source rather than calling every note missing.
 */
export const embedSource = Facet.define<EmbedSource, EmbedSource | null>({
  combine: (values) => values[0] ?? null,
});

/** The name a store todo's embed carries, `![[kt-1a2b3c]]`: a todo, never a note. */
export const TODO_ID = /^kt-[0-9a-f]{6}$/;

/** How many embeds the view sits inside. The note being edited is depth 0. */
export const embedDepth = Facet.define<number, number>({
  combine: (values) => values[0] ?? 0,
});

/**
 * How deep embeds nest before the next draws as a stub. A self-embedding note would otherwise draw
 * forever, and the cap also spares a long honest chain views nobody scrolls to.
 */
export const EMBED_DEPTH = 3;

/**
 * Reads each note through the query cache under `["note", path]`, the key the note's own pane uses.
 * That shared key keeps an embed current: a vault write refetches it, and autosaves land in it.
 * No retry, since a missing note answers 404 and retrying only delays the stub. `open` is the
 * route's, since only it knows the focused pane.
 */
export function queryEmbedSource(
  client: QueryClient,
  open: (path: string, line?: number) => void,
  openPdf: (path: string, page?: number) => void,
  openTable?: (path: string) => void,
): EmbedSource {
  // A store write sends no vault event, so the listing is asked again once it settles.
  const relist = (write: Promise<unknown>) => {
    const again = () => client.invalidateQueries({ queryKey: ["todos"] });
    void write.then(again, again);
  };
  return {
    watch(path, listener) {
      const queryKey = ["note", path];
      const hash = hashKey(queryKey);
      // The observer fires on every state change, fetch flags included; only a new text passes.
      let last: string | null | undefined;
      const report = (result: QueryObserverResult<string>) => {
        // A failed refetch keeps the old text: a dropped connection is no cause to call it missing.
        const text = result.data ?? (result.status === "error" ? null : undefined);
        if (text === undefined || text === last) return;
        last = text;
        listener(text);
      };
      const arm = () => {
        const observer = new QueryObserver<string>(client, {
          queryKey,
          queryFn: () => fetchNote(path),
          retry: false,
        });
        const stop = observer.subscribe(report);
        // A cached note fires nothing on subscribe, so report it now.
        report(observer.getCurrentResult());
        return stop;
      };
      let stopObserver: (() => void) | null = arm();
      // Trashing removes the query, but an observer stays on its old query and the embed would keep
      // the trashed body. So the cache is watched for that removal, and for the key coming back.
      const stopCache = client.getQueryCache().subscribe((event) => {
        if (event.query.queryHash !== hash) return;
        if (event.type === "removed" && stopObserver) {
          stopObserver();
          stopObserver = null;
          last = null;
          listener(null);
        } else if (event.type === "added" && !stopObserver) {
          stopObserver = arm();
        }
      });
      return () => {
        stopObserver?.();
        stopObserver = null;
        stopCache();
      };
    },
    // The pane's own listing, so an embed and the todo pane show one answer.
    watchTodo(id, listener) {
      const observer = new QueryObserver<TodoHit[]>(client, {
        queryKey: ["todos", false],
        queryFn: () => fetchTodos(false),
        // Each embed mounts its own observer, which would refetch the list on every mount.
        staleTime: 10_000,
      });
      let last: TodoRow | null | undefined;
      const report = (result: QueryObserverResult<TodoHit[]>) => {
        if (result.data === undefined) return;
        const row = result.data.find((hit) => hit.todo?.id === id)?.todo ?? null;
        if (row === last || (row !== null && row.version === last?.version)) return;
        last = row;
        listener(row);
      };
      const stop = observer.subscribe(report);
      report(observer.getCurrentResult());
      return stop;
    },
    cycleTodo(id) {
      relist(cycleStoreTodo(id));
    },
    todos() {
      const rows = new Map<string, TodoRow>();
      for (const [, hits] of client.getQueriesData<TodoHit[]>({ queryKey: ["todos"] })) {
        for (const hit of hits ?? []) if (hit.todo) rows.set(hit.todo.id, hit.todo);
      }
      return [...rows.values()];
    },
    async addTodo(note, line) {
      const added = addTodoLine(line, { note });
      relist(added);
      const [row] = await added;
      if (row === undefined) throw new Error("the store answered no todo");
      return row.id;
    },
    setTodoState(id, state) {
      relist(setTodoState(id, state));
    },
    // The pane's `@`: the rendered line from the listing, its note's lines for the client check.
    agentTodo(id) {
      const hit = client
        .getQueriesData<TodoHit[]>({ queryKey: ["todos"] })
        .flatMap(([, hits]) => hits ?? [])
        .find((each) => each.todo?.id === id);
      if (hit?.todo == null) return "that todo is not listed";
      const pressed = agentPress(
        listedLines(client, hit),
        hit.line,
        readClock(new Date()).date,
        newId(),
      );
      if ("why" in pressed) return pressed.why;
      relist(changeTodoLine(id, pressed.line.trimStart(), hit.todo.version));
      return null;
    },
    // A pdf goes to kasten's own viewer, since phone viewers ignore `#page` (#353), and a csv or a
    // video file to the image's pane. Other files get a tab, since `open` would read their bytes as note text.
    open(path, line) {
      if (path.toLowerCase().endsWith(".pdf")) openPdf(path, line);
      else if (openTable && opensInFilePane(path)) openTable(path);
      else if (namesAFile(path)) window.open(`/api/assets/${encodePath(path)}`, "_blank");
      else open(path, line);
    },
  };
}
