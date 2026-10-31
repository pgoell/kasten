import type { RefObject } from "react";
import type { BoardKeys } from "@/components/todo-board";
import type { EditorCommands } from "@/lib/key-bindings";
import type { TodoState } from "@/lib/todo/todo";
import type { Mode } from "@/lib/todo/use-todo-rows";
import { useLeader } from "@/lib/use-leader";

/**
 * The state each shifted key names. `p` for in progress, `d` being spent; `v`
 * for verify, `r` being spent. The order is the `⋯` strip's.
 */
export const SET: Record<string, TodoState> = {
  O: "open",
  P: "doing",
  V: "review",
  X: "done",
  B: "blocked",
  W: "waiting",
  R: "rejected",
};

/**
 * What each key does to the pane, said once so a key and a button can both
 * reach it. The pane makes the row checks in each; the keys only choose.
 */
export interface TodoKeyActions {
  toggleBoard(): void;
  down(): void;
  up(): void;
  enter(): void;
  cycle(): void;
  set(state: TodoState): void;
  timer(): void;
  agent(): void;
  refile(): void;
  add(): void;
  subtask(): void;
  edit(): void;
  block(): void;
  show(list: Mode): void;
  nextView(): void;
  filter(): void;
  cancelPick(): void;
}

/**
 * The pane's key handler: what a key does in the list, the picker or the board,
 * and which keys are left to the input or the editor.
 */
export function useTodoKeys(o: {
  commands: EditorCommands;
  boardKeys: RefObject<BoardKeys | null>;
  editing: boolean;
  picking: boolean;
  board: boolean;
  act: TodoKeyActions;
}): (event: React.KeyboardEvent) => void {
  const { commands, boardKeys, editing, picking, board, act } = o;
  const leader = useLeader(commands);

  return (event) => {
    if (leftAlone(event, editing)) return;
    const { key } = event;

    if (leader.feed(event)) return;

    // The picker only moves, narrows, takes and cancels: other keys would act on a row to be chosen.
    if (picking && !["j", "k", "/", "Enter", "Escape"].includes(key)) return;

    if (board && boardStops(event, boardKeys)) return;

    if (listKey(event, { commands, leader, picking, act })) event.preventDefault();
  };
}

/** Whether a key is not the list's: typing in an input or the row editor, or Enter and Space on a button other than the cursor's. */
function leftAlone(event: React.KeyboardEvent, editing: boolean): boolean {
  // Typing in an input is not the list's keys: `j` there is a letter. Nor is a key on a row's hint, which tab reaches.
  if (event.target instanceof HTMLInputElement || editing) return true;
  const { key, target } = event;
  // Only the cursor's row or card keeps Enter and Space; other buttons' presses are their own.
  if ((key !== "Enter" && key !== " ") || !(target instanceof HTMLButtonElement)) return false;
  const cursor =
    target.tabIndex === 0 &&
    (target.dataset.row !== undefined || target.dataset.card !== undefined);
  return !cursor;
}

/** Whether the board ends a key here: by taking it, or by leaving it to no one. */
function boardStops(event: React.KeyboardEvent, boardKeys: RefObject<BoardKeys | null>): boolean {
  // The board takes its own keys; of the rest only the shared ones go on, as the others name rows it does not draw.
  if (boardKeys.current?.onKey(event.key)) {
    event.preventDefault();
    return true;
  }
  return ![" ", "/", "q", "v", "c", "Escape"].includes(event.key);
}

/** Run the list key `event` names; false for a key the list has no use for. */
function listKey(
  event: React.KeyboardEvent,
  o: {
    commands: EditorCommands;
    leader: ReturnType<typeof useLeader>;
    picking: boolean;
    act: TodoKeyActions;
  },
): boolean {
  const { commands, leader, picking, act } = o;
  const { key } = event;
  switch (key) {
    case "c":
      act.toggleBoard();
      break;
    case "j":
      act.down();
      break;
    case "k":
      act.up();
      break;
    case " ":
      leader.start(event);
      break;
    case "Enter":
      act.enter();
      break;
    // The editor's `<leader>x` without the leader, which needs no buffer here.
    case "x":
      act.cycle();
      break;
    // The walk cannot reach review, blocked, waiting or rejected: a row leaves the list once done.
    // These shifted keys are how you get to them.
    case "O":
    case "P":
    case "V":
    case "X":
    case "B":
    case "W":
    case "R":
      act.set(SET[key] as TodoState);
      break;
    // Open or close: the vault decides, since only the write sees whether one is open.
    case "t":
      act.timer();
      break;
    // The `#agent` tag; the write adds or removes it as the note holds the line.
    case "@":
      act.agent();
      break;
    // One todo per press, so no bulk move ever happens.
    case "m":
      act.refile();
      break;
    // The only key that writes a note nothing on screen names: today's, wherever the cursor is.
    case "a":
      act.add();
      break;
    // `a` for the row, not the day: what it takes goes beside the cursor's line.
    case "s":
      act.subtask();
      break;
    // vim's key to type where the cursor is; the row becomes its line and is edited there.
    case "i":
      act.edit();
      break;
    // Lowercase beside `B`: that sets the state, this says what it waits for.
    case "b":
      act.block();
      break;
    // One field, not two booleans: two flags could both be on.
    case "d":
      act.show("done");
      break;
    case "n":
      act.show("next");
      break;
    // Walking is the whole picker. An overlay is for when a vault has too many views to walk.
    case "v":
      act.nextView();
      break;
    // Narrows, as in vim. The input cannot hold the focus, or `j` and `k` would stop moving the cursor.
    case "/":
      act.filter();
      break;
    case "q":
      commands.closeNote();
      break;
    case "Escape":
      if (picking) {
        act.cancelPick();
        break;
      }
      // The editor has no React handle here, so find it by its class.
      document.querySelector<HTMLElement>(".cm-content")?.focus();
      break;
    default:
      return false;
  }
  return true;
}
