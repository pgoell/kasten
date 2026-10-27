import { useQueryClient } from "@tanstack/react-query";
import { type Dispatch, type RefObject, type SetStateAction, useCallback, useState } from "react";
import { createNote, NoteExists, updateNote } from "@/lib/api";
import { heldText } from "@/lib/held-text";
import {
  dayNote,
  type LineAt,
  lineAbove,
  removeLine,
  replaceLine,
  restoreLine,
} from "@/lib/log/log-edit";
import { LOG_HEADING } from "@/lib/log/log-lines";
import { appendUnder } from "@/lib/note-section";
import type { GuardedWrites } from "@/lib/use-guarded-writes";

export type LogActions = ReturnType<typeof useLogActions>;

/** The line the last delete took out, and where the one undo puts it back. */
interface Removed {
  day: string;
  at: LineAt;
  above: string | null;
}

/** What stops a write to `path` now, or null: text held for it, its focus, or a save in the air. */
function busyOf(
  focusedNote: RefObject<{ path: string | undefined; isWriting: (note: string) => boolean }>,
  path: string,
): string | null {
  if (heldText(path) !== undefined) return `${path} holds text not yet saved`;
  const focused = focusedNote.current;
  if (focused.path === path) return `${path} is open to type in`;
  if (focused.isWriting(path)) return `${path} is still being saved`;
  return null;
}

/**
 * Every write the log pane makes into a day's note: add, edit, delete and the
 * undo of the last delete.
 *
 * The guards are the todo writes': asked at the press, inside the queued write and
 * inside the update's change, since the write can wait behind a save.
 */
export function useLogActions({
  data,
  write,
  focusedNote,
  setNotice,
}: {
  data: string[] | undefined;
  write: GuardedWrites["write"];
  focusedNote: RefObject<{ path: string | undefined; isWriting: (note: string) => boolean }>;
  setNotice: Dispatch<SetStateAction<string | undefined>>;
}) {
  const queryClient = useQueryClient();
  const [removed, setRemoved] = useState<Removed>();

  /**
   * One change to a note, or the note made from `body` when the listing lacks it.
   *
   * A note made meanwhile (`NoteExists`) is changed instead, as the drink write
   * does. Answers whether the change landed; a refusal sets its why as the notice.
   */
  const logWrite = useCallback(
    async (
      path: string,
      change: (text: string) => string | { why: string },
      body?: string,
    ): Promise<boolean> => {
      setNotice(undefined);
      const before = busyOf(focusedNote, path);
      if (before !== null) {
        setNotice(`Nothing logged: ${before}`);
        return false;
      }

      let why = "";
      const guarded = (text: string): string | null => {
        const now = busyOf(focusedNote, path);
        if (now !== null) {
          why = now;
          return null;
        }
        const next = change(text);
        if (typeof next !== "string") {
          why = next.why;
          return null;
        }
        return next;
      };

      try {
        const landed = await write(path, async () => {
          if (body !== undefined && !(data ?? []).includes(path)) {
            const made = guarded(body);
            if (made === null) return false;
            try {
              const note = await createNote(path, made);
              queryClient.setQueryData(["note", path], note.content);
              return true;
            } catch (error) {
              if (!(error instanceof NoteExists)) throw error;
            }
          }
          const written = await updateNote(path, guarded);
          if (written === null) return false;
          queryClient.setQueryData(["note", path], written.content);
          return true;
        });
        if (!landed) {
          setNotice(`Nothing logged: ${why}`);
          return false;
        }
      } catch (error) {
        // A 500, the network, or refused over its base three times.
        setNotice(
          `Nothing logged: ${error instanceof Error ? error.message : "the vault refused the write"}`,
        );
        return false;
      }

      void queryClient.invalidateQueries({ queryKey: ["log"] });
      void queryClient.invalidateQueries({ queryKey: ["files"] });
      return true;
    },
    [data, write, focusedNote, setNotice, queryClient],
  );

  const addLine = useCallback(
    (day: string, line: string): Promise<boolean> => {
      const { path, body } = dayNote(day);
      return logWrite(path, (text) => appendUnder(text, LOG_HEADING, line), body);
    },
    [logWrite],
  );

  const editLine = useCallback(
    (day: string, at: LineAt, next: string): Promise<boolean> =>
      logWrite(dayNote(day).path, (text) => replaceLine(text, at, next)),
    [logWrite],
  );

  const deleteLine = useCallback(
    async (day: string, at: LineAt): Promise<boolean> => {
      // Read from the text the removal is made to, which is the one that lands.
      let above: string | null = null;
      const done = await logWrite(dayNote(day).path, (text) => {
        above = lineAbove(text, at);
        return removeLine(text, at);
      });
      if (done) setRemoved({ day, at, above });
      return done;
    },
    [logWrite],
  );

  const undoDelete = useCallback(async (): Promise<boolean> => {
    if (removed === undefined) return false;
    const { day, at, above } = removed;
    const done = await logWrite(dayNote(day).path, (text) => restoreLine(text, at, above));
    // Kept on a refusal, so the undo can be asked again once the note allows it.
    if (done) setRemoved(undefined);
    return done;
  }, [removed, logWrite]);

  return { addLine, editLine, deleteLine, undoDelete, canUndo: removed !== undefined };
}
