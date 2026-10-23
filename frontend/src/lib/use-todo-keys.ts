import type { RefObject } from "react";
import type { BoardKeys } from "@/components/todo-board";
import type { EditorCommands } from "@/lib/key-bindings";
import type { TodoState } from "@/lib/todo";
import { useLeader } from "@/lib/use-leader";
import type { Mode } from "@/lib/use-todo-rows";

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
    // Typing into an input is not the list's keys: `j` in one is a letter. The
    // filter is one, the row being edited is the other, and the pane holds no
    // third. Nor are the keys pressed on a hint under that row, which tab
    // reaches and which is still an edit rather than a walk down the list.
    if (event.target instanceof HTMLInputElement || editing) return;
    const { key, target } = event;

    // The cursor's row and card are the tab stop and keep the pane's keys. Any
    // other button's Enter and Space are its own press, left for the browser.
    if ((key === "Enter" || key === " ") && target instanceof HTMLButtonElement) {
      const cursor =
        target.tabIndex === 0 &&
        (target.dataset.row !== undefined || target.dataset.card !== undefined);
      if (!cursor) return;
    }

    if (leader.feed(event)) return;

    // The picker moves, narrows, takes and gives up. Every other key would
    // act on a row that is here to be chosen.
    if (picking && !["j", "k", "/", "Enter", "Escape"].includes(key)) return;

    // The board takes what it binds. Of the rest only the keys every mode
    // shares go on: the others name a list row the board does not draw.
    if (board) {
      if (boardKeys.current?.onKey(key)) {
        event.preventDefault();
        return;
      }
      if (![" ", "/", "q", "v", "c", "Escape"].includes(key)) return;
    }

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
      // The editor's `<leader>x` said without the leader, which a pane holding
      // no buffer has no need of.
      case "x":
        act.cycle();
        break;
      // One key per state, shifted so every lowercase key keeps its meaning.
      // The walk cannot reach review, blocked, waiting or rejected from here: a
      // row leaves this list the moment it is done, and these are how you get
      // to them.
      case "O":
      case "P":
      case "V":
      case "X":
      case "B":
      case "W":
      case "R":
        act.set(SET[key] as TodoState);
        break;
      // One key for both ends of a session: what the press does depends on
      // whether the vault holds an open one, which only the write can see.
      case "t":
        act.timer();
        break;
      // `#agent` without typing it, the tag the worker picks todos up by. The
      // write decides add or take off, from the line as the note holds it.
      case "@":
        act.agent();
        break;
      // One todo per press, so no bulk move ever happens.
      case "m":
        act.refile();
        break;
      // The one key here that writes a note nothing on screen names: the todo
      // goes into today's, wherever the cursor happens to be sitting.
      case "a":
        act.add();
        break;
      // `a` said of the row rather than of the day: the same prompt, and what
      // it takes goes in beside the cursor's own line as a part of it.
      case "s":
        act.subtask();
        break;
      // vim's own key for starting to type where the cursor is. The line is
      // the whole record, so the row becomes that line and you edit it there.
      case "i":
        act.edit();
        break;
      // Lowercase beside `B`: that one sets the state, this one says what the
      // state is waiting for.
      case "b":
        act.block();
        break;
      // One field rather than a boolean each: `d` and `n` swap the same list,
      // and two flags could both be on.
      case "d":
        act.show("done");
        break;
      case "n":
        act.show("next");
        break;
      // ponytail: walking is the whole of the picker. An overlay is what to
      // write the day a vault holds more views than are comfortable to walk.
      case "v":
        act.nextView();
        break;
      // What vim spells a narrowing. `j` and `k` have to go on moving the
      // cursor, so the input cannot hold the focus by default.
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
        // The editor is the only other place the focus belongs, and it owns no
        // React handle here, so the pane finds it the way the reader sees it.
        document.querySelector<HTMLElement>(".cm-content")?.focus();
        break;
      default:
        return;
    }
    event.preventDefault();
  };
}
