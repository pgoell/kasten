/**
 * The todo view's writes to the store. Each runs in the one turn every todo write takes,
 * sends the version the cache holds when it leaves, and puts the answered rows straight
 * into the cache, so a change typed next reads the new version.
 */

import type { QueryClient } from "@tanstack/react-query";
import type { components } from "@/lib/api-types";
import {
  patchTodo,
  setTodoState,
  type TodoChange,
  type TodoHit,
  type TodoRow,
  toggleTodoTimer,
} from "@/lib/core/api";
import { client, reason } from "@/lib/core/api-client";
import { beginPress, endPress, inTurn } from "@/lib/todo/todo-turns";
import { absorb } from "@/lib/todo/use-todo-actions";

/** The fields a new todo may start with. */
export type NewTodo = Omit<TodoChange, "version" | "epic"> & { words: string };

/** Every listed row, as the cache holds it now. */
export function cachedRows(queryClient: QueryClient): TodoRow[] {
  const rows = new Map<string, TodoRow>();
  for (const [, hits] of queryClient.getQueriesData<TodoHit[]>({ queryKey: ["todos"] })) {
    for (const hit of hits ?? []) {
      const row = hit.todo;
      if (row && (rows.get(row.id)?.version ?? 0) < row.version) rows.set(row.id, row);
    }
  }
  return [...rows.values()];
}

function versionOf(queryClient: QueryClient, id: string): number {
  const row = cachedRows(queryClient).find((each) => each.id === id);
  if (row === undefined) throw new Error("that todo is not in the list yet");
  return row.version;
}

/** One write in turn; its rows go into the cache and the list is asked again after. */
async function inStore(
  queryClient: QueryClient,
  work: () => Promise<TodoRow[]>,
): Promise<TodoRow[]> {
  const began = beginPress();
  let wrote = false;
  try {
    const rows = await inTurn(work);
    wrote = rows.length > 0;
    absorb(queryClient, rows);
    return rows;
  } finally {
    endPress(began, wrote);
    void queryClient.invalidateQueries({ queryKey: ["todos"] });
  }
}

/**
 * Change fields of a todo. A version refused as stale (a write from elsewhere landed first)
 * is read again and the change sent once more: the panel's fields are what was typed last.
 */
export function changeTodo(
  queryClient: QueryClient,
  id: string,
  change: Omit<TodoChange, "version">,
): Promise<TodoRow[]> {
  return inStore(queryClient, async () => {
    try {
      return await patchTodo(id, { ...change, version: versionOf(queryClient, id) });
    } catch (error) {
      if (!(error instanceof Error && error.message.includes("changed since it was read")))
        throw error;
      await queryClient.refetchQueries({ queryKey: ["todos"] });
      return patchTodo(id, { ...change, version: versionOf(queryClient, id) });
    }
  });
}

/** Put a todo in a state, with the stamps and parts the store drags along. */
export function stateTodo(queryClient: QueryClient, id: string, state: TodoRow["state"]) {
  return inStore(queryClient, () => setTodoState(id, state));
}

export function timerTodo(queryClient: QueryClient, id: string) {
  return inStore(queryClient, () => toggleTodoTimer(id));
}

/** Add a todo; with no note and no parent the store puts it in today's daily note. */
export function addTodo(queryClient: QueryClient, todo: NewTodo): Promise<TodoRow> {
  return inStore(queryClient, async () => {
    const { data, error, response } = await client.POST("/api/todos", {
      body: todo as components["schemas"]["NewTodo"],
    });
    if (data) return [data];
    throw new Error(
      reason(error as { detail?: unknown }) ?? `POST /api/todos failed with ${response.status}`,
    );
  }).then(async (rows) => {
    const row = rows[0];
    if (row === undefined) throw new Error("the store answered no todo");
    // `absorb` only replaces listed rows, and the caller opens the new one from the listing.
    await queryClient.refetchQueries({ queryKey: ["todos"] });
    return row;
  });
}

/** Delete a todo and its parts; their history stays in the store. */
export function deleteTodo(queryClient: QueryClient, id: string): Promise<TodoRow[]> {
  return inStore(queryClient, async () => {
    const { error, response } = await client.DELETE("/api/todos/{todo_id}", {
      params: { path: { todo_id: id } },
    });
    if (response.ok) return [];
    throw new Error(
      reason(error as { detail?: unknown }) ?? `DELETE /api/todos failed with ${response.status}`,
    );
  });
}
