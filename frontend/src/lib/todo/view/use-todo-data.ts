import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useMemo } from "react";
import { fetchFiles, fetchTodos, type TodoRow } from "@/lib/core/api";
import { parseSession } from "@/lib/todo/todo-time";

/** The folders todos can belong to: every project a todo has, and each project folder in the vault. */
function projectsOf(rows: TodoRow[], files: string[] | undefined): string[] {
  const found = new Set(rows.flatMap((row) => (row.project === null ? [] : [row.project])));
  for (const path of files ?? []) {
    const parts = path.split("/");
    if (parts.length > 2 && (parts[0] === "02 Projects" || parts[0] === "03 Areas")) {
      found.add(`${parts[0]}/${parts[1]}`);
    }
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}

/**
 * The store's todos as rows, under the todo list's query key so every pane shares one answer,
 * with the timers running and the vault's files and projects beside them.
 */
export function useTodoData(archive: boolean) {
  const { data: answer } = useQuery({
    queryKey: ["todos", archive],
    queryFn: () => fetchTodos(archive),
  });
  // Deferred so a long answer renders in yielding passes, as the list's does (#1355).
  const hits = useDeferredValue(answer);
  const { data: files } = useQuery({ queryKey: ["files"], queryFn: fetchFiles });
  return useMemo(() => {
    const rows = (hits ?? []).flatMap((hit) => (hit.todo ? [hit.todo] : []));
    // A running timer is listed as its session line, which names the todo but carries no row.
    const running = new Set(
      (hits ?? []).flatMap((hit) => (hit.todo ? [] : [parseSession(hit.text)?.id ?? ""])),
    );
    return {
      loaded: hits !== undefined,
      rows,
      byId: new Map(rows.map((row) => [row.id, row])),
      running,
      files,
      projects: projectsOf(rows, files),
    };
  }, [hits, files]);
}
