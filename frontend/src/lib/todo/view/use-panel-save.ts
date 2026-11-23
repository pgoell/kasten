import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TodoChange } from "@/lib/core/api";
import { changeTodo } from "@/lib/todo/view/todo-store";

type Fields = Omit<TodoChange, "version">;

/** How long typing rests before the panel saves it: short enough that closing loses nothing. */
const REST_MS = 400;

export type SaveState = "saved" | "saving" | "failed";

/**
 * The side panel's save as you type. Changes to one todo gather until typing rests, then go
 * as one write; switching todo, closing or unmounting sends what is gathered at once.
 */
export function usePanelSave(id: string | null, onFailed: (why: string) => void) {
  const queryClient = useQueryClient();
  const pending = useRef<{ id: string; fields: Fields } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [state, setState] = useState<SaveState>("saved");
  const failed = useRef(onFailed);
  failed.current = onFailed;

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const sent = pending.current;
    pending.current = null;
    if (sent === null) return;
    setState("saving");
    changeTodo(queryClient, sent.id, sent.fields).then(
      () => setState(pending.current === null ? "saved" : "saving"),
      (error: unknown) => {
        setState("failed");
        failed.current(error instanceof Error ? error.message : "the store refused the change");
      },
    );
  }, [queryClient]);

  const save = useCallback(
    (fields: Fields, now = false) => {
      if (id === null) return;
      if (pending.current !== null && pending.current.id !== id) flush();
      pending.current = { id, fields: { ...pending.current?.fields, ...fields } };
      setState("saving");
      clearTimeout(timer.current);
      if (now) flush();
      else timer.current = setTimeout(flush, REST_MS);
    },
    [id, flush],
  );

  // The panel is keyed by the todo, so going away is leaving it: what was typed goes now.
  useEffect(() => flush, [flush]);

  return { save, flush, state };
}
