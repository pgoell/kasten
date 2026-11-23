import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { type Dispatch, type SetStateAction, useCallback, useRef } from "react";
import type { SearchHit, TodoHit, TodoRow } from "@/lib/core/api";
import { readClock } from "@/lib/core/clock";
import { newId, parseTodo, type TodoState } from "@/lib/todo/todo";
import { listedLines } from "@/lib/todo/todo-agent";
import {
  agentTodoInVault,
  blockTodoInVault,
  cycleTodoAside,
  cycleTodoInVault,
  editTodoInVault,
  moveTodoInVault,
  type RowOf,
  toggleTimerInVault,
} from "@/lib/todo/todo-api";
import type { TodoCycle } from "@/lib/todo/todo-commands";
import { projectNote } from "@/lib/todo/todo-refile";
import { beginPress, endPress } from "@/lib/todo/todo-turns";
import { pressedLine } from "@/lib/todo/todo-write";

export type TodoActions = ReturnType<typeof useTodoActions>;

/** The notice for a todo write the store refused. */
function nothingMoved(error: unknown): string {
  return `Nothing moved: ${error instanceof Error ? error.message : "the store refused the write"}`;
}

/** Every listed todo row, newest version first, across the listings the cache holds. */
function rowsIn(queryClient: QueryClient): TodoRow[] {
  return queryClient
    .getQueriesData<TodoHit[]>({ queryKey: ["todos"] })
    .flatMap(([, hits]) => hits ?? [])
    .flatMap((hit) => (hit.todo ? [hit.todo] : []))
    .sort((a, b) => b.version - a.version);
}

/**
 * Put the rows a write answered into the listings, so the next `PATCH` sends their new version
 * before the refetch lands. Only the row moves; the line redraws with the refetch.
 */
export function absorb(queryClient: QueryClient, rows: TodoRow[]): void {
  const byId = new Map(rows.map((row) => [row.id, row]));
  queryClient.setQueriesData<TodoHit[]>({ queryKey: ["todos"] }, (hits) =>
    hits?.map((hit) => {
      const row = hit.todo ? byId.get(hit.todo.id) : undefined;
      return row === undefined ? hit : { ...hit, todo: row };
    }),
  );
}

/**
 * Draw the press on the row now, before the vault has it: the write takes several round trips.
 * The refetch once the press settles puts the vault's answer back, a refused write included.
 */
async function drawPressed(
  queryClient: QueryClient,
  hit: SearchHit,
  press: { today: string; id: string; state?: TodoState },
): Promise<void> {
  const after = pressedLine(hit.text, press.today, press.id, press.state);
  if (after === null) return;
  // A refetch already on its way was read before the press, and would draw the row back.
  // Awaited, since a cancelled fetch reverts the cache when it settles.
  await queryClient.cancelQueries({ queryKey: ["todos"] });
  queryClient.setQueriesData<TodoHit[]>({ queryKey: ["todos"] }, (rows) =>
    rows?.map((row) =>
      row.path === hit.path && row.line === hit.line && row.text === hit.text
        ? { ...row, text: after }
        : row,
    ),
  );
}

/** Where `m` moves a todo from and to, or the notice for why it cannot. */
function moveRoute(
  hit: TodoHit,
  lane: string | undefined,
): string | { project: string; source: string; target: string } {
  const project = lane ?? hit.project;
  if (project === null) return "That todo has no project: give it one with p or a #p/x tag";
  const source = hit.path;
  const target = projectNote(project);
  if (source === target) return "That todo is in its project's note already";
  return { project, source, target };
}

/**
 * Every write a todo row, a prompt or the editor makes: cycle, timer, agent, edit, block, move and add.
 */
export function useTodoActions({
  data,
  setNotice,
}: {
  data: string[] | undefined;
  setNotice: Dispatch<SetStateAction<string | undefined>>;
}) {
  const queryClient = useQueryClient();
  /**
   * The lists a todo write moves, asked again here rather than waiting for the store's `todos` event.
   * `["files"]` too, since `cycleTodoAside` can make today's daily note.
   */
  const todosWritten = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["todos"] });
    void queryClient.invalidateQueries({ queryKey: ["files"] });
  }, [queryClient]);

  const rowOf: RowOf = useCallback(
    (id: string) => rowsIn(queryClient).find((row) => row.id === id),
    [queryClient],
  );

  /** Presses not yet settled, of every kind, so they share the one refetch below. */
  const unsettled = useRef(0);

  const settled = useCallback(
    (wrote: boolean) => {
      unsettled.current -= 1;
      // Asked once the last press lands: an earlier answer would draw a later press back.
      if (unsettled.current === 0) todosWritten();
      endPress(wrote);
    },
    [todosWritten],
  );

  const begun = useCallback(() => {
    unsettled.current += 1;
    beginPress();
  }, []);

  /** Run one store write as a press: its rows go into the cache, a refusal into the notice. */
  const press = useCallback(
    (write: () => Promise<TodoRow[]>): Promise<boolean> => {
      setNotice(undefined);
      begun();
      return write().then(
        (rows) => {
          absorb(queryClient, rows);
          // An empty answer sent no write, as a state the todo already has.
          settled(rows.length > 0);
          return true;
        },
        (error: unknown) => {
          setNotice(nothingMoved(error));
          settled(false);
          return false;
        },
      );
    },
    [queryClient, settled, setNotice, begun],
  );

  /**
   * Follow a `<leader>x` into the vault. The buffer already carries the note's own lines, so this moves only the `## Done` log and dependents.
   * A checkbox typed in a note is no store todo, so nothing here reaches the store.
   */
  const logCycledTodo = useCallback(
    (path: string, cycle: TodoCycle) => {
      void cycleTodoAside(path, cycle, readClock(new Date()).date, data ?? []).then(
        todosWritten,
        (error: unknown) => setNotice(nothingMoved(error)),
      );
    },
    [data, todosWritten, setNotice],
  );

  /** Walk one todo on, from the pane's `x` or a card drop, or set the state a key named. */
  const cycleTodo = useCallback(
    (hit: SearchHit, state?: TodoState, _twins?: number[]) => {
      // The store walks done back to open, where the line's own walk would make it plain words.
      const drawn = state ?? (parseTodo(hit.text)?.state === "done" ? "open" : undefined);
      const pressing = { today: readClock(new Date()).date, id: newId(), state: drawn };
      void drawPressed(queryClient, hit, pressing);
      void press(() => cycleTodoInVault(hit, state));
    },
    [queryClient, press],
  );

  /** Start or stop a session on the pane's `t`. */
  const toggleTimer = useCallback(
    (hit: SearchHit, _twins?: number[]) => void press(() => toggleTimerInVault(hit)),
    [press],
  );

  /** The line each `@` sent, by the listed text it changed: an `@` before the list redraws walks on from it. */
  const agentSent = useRef(new Map<string, { from: string; to: string }>());

  /**
   * Hand one todo to the agent worker, or take it back, from the pane's `@`. `lines` is the
   * row's note as listed, so a client tag on a todo above it counts.
   */
  const agentTodo = useCallback(
    (hit: SearchHit, _twins?: number[]) => {
      const key = `${hit.path}:${hit.line}`;
      const sent = agentSent.current.get(key);
      const shown = sent?.from === hit.text ? { ...hit, text: sent.to } : hit;
      const lines = listedLines(queryClient, shown);
      const remember = (line: string) => agentSent.current.set(key, { from: hit.text, to: line });
      const today = readClock(new Date()).date;
      return press(() => agentTodoInVault(shown, lines, today, rowOf, remember)).then((wrote) => {
        if (!wrote) agentSent.current.delete(key);
        return wrote;
      });
    },
    [queryClient, press, rowOf],
  );

  /** Change the todo to an edited line, from the pane's `i`. Answers whether it wrote, so the pane can keep the text (#2087). */
  const editTodo = useCallback(
    (hit: SearchHit, line: string, read?: number): Promise<boolean> =>
      press(() => editTodoInVault(hit, line, read)),
    [press],
  );

  /** Make a todo wait on the one picked, from the pane's `b`. */
  const blockTodo = useCallback(
    (hit: SearchHit, blocker: SearchHit) => void press(() => blockTodoInVault(hit, blocker, rowOf)),
    [press, rowOf],
  );

  /** Move one todo into its project's note, from the pane's `m` or a card dropped on a lane. */
  const refileTodo = useCallback(
    (hit: TodoHit, lane?: string) => {
      const route = moveRoute(hit, lane);
      if (typeof route === "string") {
        setNotice(route);
        return Promise.resolve(false);
      }
      const move = { project: route.project, note: route.target };
      return press(() => moveTodoInVault(hit, move, rowOf)).then((moved) => {
        if (moved) setNotice(`Moved into ${route.target}`);
        return moved;
      });
    },
    [press, rowOf, setNotice],
  );

  return {
    todosWritten,
    logCycledTodo,
    cycleTodo,
    toggleTimer,
    agentTodo,
    editTodo,
    blockTodo,
    refileTodo,
  };
}
