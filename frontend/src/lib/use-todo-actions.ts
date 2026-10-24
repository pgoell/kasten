import { useQueryClient } from "@tanstack/react-query";
import { type Dispatch, type RefObject, type SetStateAction, useCallback, useRef } from "react";
import { createNote, fetchNote, type SearchHit, type TodoHit, updateNote } from "@/lib/api";
import { readClock } from "@/lib/clock";
import { heldText } from "@/lib/held-text";
import type { TodoState } from "@/lib/todo";
import { agentTodoIn, cycleTodoAside, cycleTodoInVault, toggleTimerInVault } from "@/lib/todo-api";
import type { TodoCycle } from "@/lib/todo-commands";
import { blockTodoInVault, editTodoInVault } from "@/lib/todo-line-edits";
import { beginPress, endPress } from "@/lib/todo-press-echo";
import { fileUnderTodos, lineOf, projectNote, refileOf } from "@/lib/todo-refile";
import type { GuardedWrites } from "@/lib/use-guarded-writes";

export type TodoActions = ReturnType<typeof useTodoActions>;

/** The notice for a todo write from the pane or the editor that the vault refused or could not place. */
function nothingMoved(error: unknown): string {
  return `Nothing moved: ${error instanceof Error ? error.message : "the vault refused the write"}`;
}

/**
 * Every write a todo row or the editor makes into the vault: cycle, timer,
 * agent, edit, block and refile.
 */
export function useTodoActions({
  data,
  archive,
  write,
  focusedNote,
  setNotice,
}: {
  data: string[] | undefined;
  archive: boolean;
  write: GuardedWrites["write"];
  focusedNote: RefObject<{ path: string | undefined; isWriting: (note: string) => boolean }>;
  setNotice: Dispatch<SetStateAction<string | undefined>>;
}) {
  const queryClient = useQueryClient();
  /**
   * The two lists a todo write moves, asked for again rather than left to
   * `/api/events`.
   *
   * The stream is the belt and this the braces: the row you just pressed should
   * redraw off the write it asked for. `["files"]` with it, because both writes
   * can make today's daily note.
   */
  const todosWritten = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["todos"] });
    void queryClient.invalidateQueries({ queryKey: ["files"] });
  }, [queryClient]);

  /**
   * A pane press has settled, its writes all landed or not.
   *
   * The list is asked once here, even when a write failed after an earlier one
   * landed: the echoes of the landed writes are muted by `endPress`, so nothing
   * else would redraw the row they changed.
   */
  const settled = useCallback(() => {
    todosWritten();
    endPress();
  }, [todosWritten]);

  /**
   * Follow a `<leader>x` into the vault, from the editor.
   *
   * The buffer already carries every line of this note the press moved and
   * autosave writes them, so this moves the `## Done` log and the dependents
   * living in other notes. It reads nothing at all for a press that neither
   * touches an end of done nor moves a blocker, which is half of them.
   */
  const logCycledTodo = useCallback(
    (path: string, cycle: TodoCycle) => {
      void cycleTodoAside(path, cycle, readClock(new Date()).date, data ?? []).then(
        todosWritten,
        // The line in the buffer stands either way. The notice is what says the
        // log and the dependents did not follow it, and why: a refused write, or
        // an id another todo carries too, which no second press would mend.
        (error: unknown) => setNotice(nothingMoved(error)),
      );
    },
    [data, todosWritten, setNotice],
  );

  /**
   * Walk one todo on, in the vault, from the pane's `x`, or set the state a key
   * named or a card was dropped on.
   *
   * A refused write says so: a dropped card goes back to the column it left,
   * since the board draws the vault, and without a notice the drop would look
   * ignored. A line the write can no longer find writes nothing and says so too.
   */
  const cycleTodo = useCallback(
    (hit: SearchHit, state?: TodoState, twins?: number[]) => {
      setNotice(undefined);
      beginPress();
      void cycleTodoInVault(hit, readClock(new Date()).date, data ?? [], state, twins)
        .catch((error: unknown) => setNotice(nothingMoved(error)))
        .finally(settled);
    },
    [data, settled, setNotice],
  );

  /**
   * Start or stop a session on the pane's `t`.
   *
   * The whole clock, not just the day: a session line carries the time, and
   * reading it here keeps the pane and the rules below it functions of strings.
   * A refused write says so, as a state's does: a row whose line has moved
   * under it would otherwise look like a press that did nothing.
   */
  const toggleTimer = useCallback(
    (hit: SearchHit, twins?: number[]) => {
      setNotice(undefined);
      beginPress();
      void toggleTimerInVault(hit, readClock(new Date()), data ?? [], twins)
        .catch((error: unknown) => setNotice(nothingMoved(error)))
        .finally(settled);
    },
    [data, settled, setNotice],
  );

  /**
   * Hand one todo to the agent worker, or take it back, from the pane's `@`.
   *
   * In the note's queue with `m`'s guards, asked before and again inside the
   * write, for `m`'s reasons: the press was made in the pane, not in the note,
   * and an editor holding it would save its own copy over the tag. The rule
   * reads the note as the write finds it, so a second press before the list
   * redraws sees the first's tag and takes it off again: it goes by the line
   * the first wrote, kept in `agentLines`, because the row still shows the
   * words from before.
   */
  const agentLines = useRef(new Map<string, { listing: number; line: string }>());
  const tagTodo = useCallback(
    async (hit: SearchHit, twins?: number[]) => {
      setNotice(undefined);
      const note = hit.path;
      // The pane's listing the row was drawn from, by when it arrived: a line
      // kept from a press on an older listing says nothing about a row of this.
      const listing = queryClient.getQueryState(["todos", archive])?.dataUpdatedAt ?? 0;
      const row = `${note}\n${hit.line}\n${hit.text}`;
      const busy = (): string | null => {
        if (heldText(note) !== undefined) return `${note} holds text not yet saved`;
        const focused = focusedNote.current;
        if (focused.path === note) return `${note} is open to type in`;
        if (focused.isWriting(note)) return `${note} is still being saved`;
        return null;
      };
      const before = busy();
      if (before !== null) {
        setNotice(`Nothing moved: ${before}`);
        return;
      }

      let why = nothingMoved(undefined);
      const today = readClock(new Date()).date;
      const tagged = await write(note, async () => {
        const now = busy();
        if (now !== null) {
          why = `Nothing moved: ${now}`;
          return false;
        }
        // Read here, behind the press before it in the queue, which is what
        // puts the line it wrote in the map. Replaced only once this press
        // lands, so one refused leaves it for the next.
        const kept = agentLines.current.get(row);
        const mine = kept?.listing === listing;
        // The words the note now holds for this row, so `rowLine` finds it
        // exactly. The twins were counted on the listed words, not these.
        const pressing = mine ? { ...hit, text: kept.line } : hit;
        let line = "";
        const written = await updateNote(note, (text) => {
          const again = busy();
          if (again !== null) {
            why = `Nothing moved: ${again}`;
            return null;
          }
          // The kept line names this todo only while no other line says the
          // same: a write since may have shifted a twin onto its number.
          if (mine && text.split("\n").filter((each) => each === kept.line).length !== 1) {
            why = "Nothing moved: that line has changed since it was listed";
            return null;
          }
          const pressed = agentTodoIn(text, pressing, today, mine ? undefined : twins);
          if ("why" in pressed) {
            why = `Nothing moved: ${pressed.why}`;
            return null;
          }
          line = pressed.line;
          return pressed.text;
        }).then(
          (landed) => landed,
          // A 500, the network, or refused over its base three times.
          (error: unknown) => {
            why = nothingMoved(error);
            return null;
          },
        );
        if (written === null) return false;
        queryClient.setQueryData(["note", note], written.content);
        // Lines kept from an older listing go: no row drawn now carries them.
        for (const [key, each] of agentLines.current) {
          if (each.listing !== listing) agentLines.current.delete(key);
        }
        agentLines.current.set(row, { listing, line });
        return true;
      });
      if (!tagged) {
        setNotice(why);
        return;
      }
    },
    [queryClient, write, archive, focusedNote, setNotice],
  );
  const agentTodo = useCallback(
    (hit: SearchHit, twins?: number[]) => {
      beginPress();
      return tagTodo(hit, twins).finally(settled);
    },
    [tagTodo, settled],
  );

  /**
   * Put an edited line back in its note, from the pane's `e`.
   *
   * No clock: the line is written as it was typed, so there is no date for
   * kasten to stamp on it. The pane has already put the row back and taken the
   * keys with it; this is only the write.
   */
  const editTodo = useCallback(
    (hit: SearchHit, line: string) => {
      beginPress();
      // The vault refused the write, or the note moved out from under the row.
      // The list stays as it is, and the settle below asks for it anyway.
      void editTodoInVault(hit, line)
        .catch(() => {})
        .finally(settled);
    },
    [settled],
  );

  /**
   * Write a `⛔` naming the todo picked, from the pane's `b`.
   *
   * A refusal says why, as a press's does: a blocker whose id another todo
   * carries too writes nothing, and the pick would look ignored without it.
   */
  const blockTodo = useCallback(
    (hit: SearchHit, blocker: SearchHit) => {
      beginPress();
      void blockTodoInVault(hit, blocker)
        .catch((error: unknown) => setNotice(nothingMoved(error)))
        .finally(settled);
    },
    [settled, setNotice],
  );

  /**
   * Move one todo, and every line under it, into its project's note, from the
   * pane's `m`, or into the project of the lane a card was dropped on.
   *
   * The project's note is written first and the note the todo left second, so
   * a write failing between the two leaves the todo in both and never in none.
   * Each in its note's queue, with `linkMentionOf`'s guards asked before and
   * again inside the write, for its reasons: the press was made in the pane,
   * not in either note. The project is the backend's, so the todo lands in the
   * lane the board draws it in. A drop names the lane's instead, which is how
   * a card in "No project" gets one: the same path, so a drop is no second move.
   */
  const moveTodo = useCallback(
    async (hit: TodoHit, lane?: string) => {
      setNotice(undefined);
      const project = lane ?? hit.project;
      if (project === null) {
        setNotice("That todo has no project: give it one with p or a #p/x tag");
        return;
      }
      const source = hit.path;
      const target = projectNote(project);
      if (source === target) {
        setNotice("That todo is in its project's note already");
        return;
      }

      const busy = (note: string): string | null => {
        if (heldText(note) !== undefined) return `${note} holds text not yet saved`;
        const focused = focusedNote.current;
        if (focused.path === note) return `${note} is open to type in`;
        if (focused.isWriting(note)) return `${note} is still being saved`;
        return null;
      };
      const before = busy(target) ?? busy(source);
      if (before !== null) {
        setNotice(`Nothing moved: ${before}`);
        return;
      }

      // The block as the note holds it now, checked against what the row read:
      // a row the vault has moved past would move whatever sits there instead.
      const read = await fetchNote(source).then(
        (text) => text,
        () => null,
      );
      // By its text where a write since has shifted it, a press of `m` on
      // another todo of this note among them: the list has not redrawn yet.
      const at = read === null ? null : lineOf(read, hit.line, hit.text);
      const moved = read === null || at === null ? null : refileOf(read, at, project);
      if (moved === null) {
        setNotice("Nothing moved: that line has changed since it was listed");
        return;
      }

      let why = `Nothing moved: ${target} was not written`;
      const filed = await write(target, async () => {
        const now = busy(target);
        if (now !== null) {
          why = `Nothing moved: ${now}`;
          return false;
        }
        // The backend names only folders it found, so a project without its
        // note gets the one `p` already links to.
        if (!queryClient.getQueryData<string[]>(["files"])?.includes(target)) {
          const made = await createNote(target, `## TODOs\n${moved.block}\n`).then(
            (note) => note,
            () => null,
          );
          if (made === null) return false;
          queryClient.setQueryData(["note", made.path], made.content);
          // Into the listing at once, so a second press queued behind this one
          // writes into the note rather than making it again and being refused.
          queryClient.setQueryData<string[]>(["files"], (paths) =>
            paths === undefined || paths.includes(made.path) ? paths : [...paths, made.path],
          );
          return true;
        }
        // Already there, from a press whose second write was refused: this
        // press finishes that move rather than copying the todo twice.
        let there = false;
        const written = await updateNote(target, (text) => {
          const again = busy(target);
          if (again !== null) {
            why = `Nothing moved: ${again}`;
            return null;
          }
          const next = fileUnderTodos(text, moved.block);
          there = next === null;
          return next;
        }).then(
          (landed) => landed,
          // A 500, the network, or refused over its base three times.
          () => null,
        );
        if (written !== null) queryClient.setQueryData(["note", target], written.content);
        return written !== null || there;
      });
      if (!filed) {
        setNotice(why);
        return;
      }

      // Not "stays there": a part moved inside its parent's block a press
      // earlier is gone from the source, so the notice asks for a look instead.
      const stays = (reason: string) =>
        `Copied into ${target}; ${reason}, so check ${source} before pressing again`;
      let left = stays(`${source} was not written`);
      const taken = await write(source, async () => {
        const now = busy(source);
        if (now !== null) {
          left = stays(now);
          return false;
        }
        const written = await updateNote(source, (text) => {
          const again = busy(source);
          if (again !== null) {
            left = stays(again);
            return null;
          }
          // The todo or a line under it changed since the copy was made, so
          // taking it out would lose what the copy does not hold.
          const line = lineOf(text, hit.line, hit.text);
          const fresh = line === null ? null : refileOf(text, line, project);
          if (fresh === null || fresh.block !== moved.block) {
            left = stays(`${source} changed`);
            return null;
          }
          return fresh.left;
        }).then(
          (landed) => landed,
          () => null,
        );
        if (written !== null) queryClient.setQueryData(["note", source], written.content);
        return written !== null;
      });

      // The move went through the vault and not a buffer, so `u` cannot reach it.
      setNotice(
        taken
          ? `Moved into ${target}. The history pane's restore on both notes takes it back`
          : left,
      );
    },
    [queryClient, write, focusedNote, setNotice],
  );
  const refileTodo = useCallback(
    (hit: TodoHit, lane?: string) => {
      beginPress();
      return moveTodo(hit, lane).finally(settled);
    },
    [moveTodo, settled],
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
