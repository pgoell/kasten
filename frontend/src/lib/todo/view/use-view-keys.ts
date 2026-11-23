import { useRef } from "react";
import type { EditorCommands } from "@/lib/ui/keys/key-bindings";
import { useLeader } from "@/lib/ui/keys/use-leader";

/** What the todo view's keys do; the view makes the row checks, the keys only choose. */
export interface ViewKeyActions {
  move(step: number): void;
  edit(): void;
  tick(): void;
  add(): void;
  filter(): void;
  goToNote(): void;
  /** Open the date, state or priority popover on the cursor's row. */
  pick(kind: "date" | "state" | "priority"): void;
  /** Open the note picker in the todo panel, when one is open. */
  linkNote(): void;
  close(): boolean;
}

/**
 * Typing in a field, or a chord, is not the table's: `j` in the title is a letter. Enter and
 * Space on a focused button or link are its click.
 */
function leftAlone(event: React.KeyboardEvent): boolean {
  const target = event.target as HTMLElement;
  const clicking = (event.key === "Enter" || event.key === " ") && target.closest("button, a");
  return (
    target.matches("input, textarea, select") ||
    Boolean(clicking) ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  );
}

/**
 * The view's key handler. Escape closes the panel from anywhere in it; the rest act on the
 * table's cursor, and Space starts the leader as in every pane.
 */
export function useViewKeys(commands: EditorCommands, act: ViewKeyActions, idle: boolean) {
  const leader = useLeader(commands);
  const afterG = useRef(false);

  return (event: React.KeyboardEvent) => {
    if (event.key === "Escape" && act.close()) {
      event.preventDefault();
      return;
    }
    if (idle || leftAlone(event) || leader.feed(event)) return;
    if (afterG.current) {
      afterG.current = false;
      if (event.key === "n") act.goToNote();
      event.preventDefault();
      return;
    }
    const keys: Record<string, () => void> = {
      " ": () => leader.start(event),
      j: () => act.move(1),
      ArrowDown: () => act.move(1),
      k: () => act.move(-1),
      ArrowUp: () => act.move(-1),
      Enter: act.edit,
      x: act.tick,
      a: act.add,
      "/": act.filter,
      d: () => act.pick("date"),
      s: () => act.pick("state"),
      p: () => act.pick("priority"),
      n: act.linkNote,
      g: () => {
        afterG.current = true;
      },
    };
    const run = keys[event.key];
    if (run === undefined) return;
    event.preventDefault();
    run();
  };
}
