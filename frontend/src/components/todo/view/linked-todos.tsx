import { useQueryClient } from "@tanstack/react-query";
import { TodoStateBox } from "@/components/todo/todo-state-box";
import { Icon, PriorityBars } from "@/components/todo/view/view-icons";
import type { TodoRow } from "@/lib/core/api";
import { readClock } from "@/lib/core/clock";
import { noteName } from "@/lib/notes/links/note-path";
import { todosLinking } from "@/lib/todo/view/rows/note-links";
import { dateCell } from "@/lib/todo/view/rows/row-facts";
import { stateTodo } from "@/lib/todo/view/todo-store";
import { useTodoData } from "@/lib/todo/view/use-todo-data";

/**
 * The todos elsewhere whose words or description link to this note, at the note's foot. A box
 * ticks one; its note's name opens where it lives. Nothing is drawn while none link here.
 */
export function LinkedTodos(props: {
  path: string;
  onOpen: (path: string) => void;
  onNotice: (text: string) => void;
}) {
  const queryClient = useQueryClient();
  const data = useTodoData(false);
  const rows = data.files === undefined ? [] : todosLinking(data.rows, props.path, data.files);
  if (rows.length === 0) return null;
  const today = readClock(new Date()).date;
  const tick = (row: TodoRow) =>
    void stateTodo(queryClient, row.id, row.state === "done" ? "open" : "done").catch(
      (error: unknown) =>
        props.onNotice(`Not saved: ${error instanceof Error ? error.message : error}`),
    );
  return (
    <section
      aria-label="Todos that link here"
      className="max-h-[min(14rem,35%)] shrink-0 overflow-y-auto border-k-rule border-t px-6 py-3 font-sans"
    >
      <h3 className="mb-1 font-semibold text-[15px] text-k-ink">
        Todos that link here <span className="ml-1 font-normal text-k-muted">{rows.length}</span>
      </h3>
      <ul>
        {rows.map((row) => {
          const done = row.state === "done";
          const date = dateCell(row, today);
          return (
            <li
              key={row.id}
              className="flex min-h-10 items-center gap-3 border-k-rule border-b text-[15px]"
            >
              <PriorityBars priority={row.priority} />
              <button
                type="button"
                aria-label={done ? `Open ${row.words} again` : `Done: ${row.words}`}
                onClick={() => tick(row)}
                className="rounded-full p-0.5 hover:bg-k-rule"
              >
                <TodoStateBox state={row.state} />
              </button>
              <span
                className={`min-w-0 flex-1 truncate ${done ? "text-k-muted line-through" : "text-k-ink"}`}
              >
                {row.words}
              </span>
              {row.note !== null && (
                <button
                  type="button"
                  onClick={() => row.note && props.onOpen(row.note)}
                  className="flex min-w-0 shrink items-center gap-1.5 text-k-ink-soft text-sm hover:text-k-ink"
                >
                  <Icon name="doc" className="text-k-muted" />
                  <span className="truncate">{noteName(row.note)}</span>
                </button>
              )}
              <span
                className={`w-16 shrink-0 text-right font-mono text-sm ${date?.late ? "text-k-danger" : "text-k-ink-soft"}`}
              >
                {date?.text}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
