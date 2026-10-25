import type { Dispatch, RefObject, SetStateAction } from "react";
import { FinancePane } from "@/components/finance-pane";
import { LogPane } from "@/components/log-pane";
import { OverviewPane } from "@/components/overview-pane";
import { ReviewPane } from "@/components/review-pane";
import { type AgentRow, TodoPane } from "@/components/todo-pane";
import type { SearchHit } from "@/lib/api";
import { readClock } from "@/lib/clock";
import type { TreeCommands } from "@/lib/key-bindings";
import type { Pane } from "@/lib/panes";
import type { LogActions } from "@/lib/use-log-actions";
import type { NoteOpening } from "@/lib/use-note-opening";
import type { TodoActions } from "@/lib/use-todo-actions";

export interface WholePaneProps {
  pane: Pick<Pane, "overview" | "finance" | "log" | "todos" | "review">;
  commands: TreeCommands;
  focused: boolean;
  focusSignal: number;
  archive: boolean;
  openInPane: NoteOpening["openInPane"];
  logActions: LogActions;
  onNotice: Dispatch<SetStateAction<string | undefined>>;
  todos: Pick<
    TodoActions,
    "cycleTodo" | "editTodo" | "blockTodo" | "toggleTimer" | "agentTodo" | "refileTodo"
  >;
  onTodoPrompt: (parent?: SearchHit) => void;
  todoRow: RefObject<AgentRow | null>;
}

/** Whether a pane holds one of the five kinds that fill the whole pane. */
export function isWholePane(pane: WholePaneProps["pane"]): boolean {
  return (
    pane.overview === true ||
    pane.finance === true ||
    pane.log === true ||
    pane.todos === true ||
    pane.review === true
  );
}

/**
 * The overview, the log, the todo list and the review, each drawn over the whole pane. Moved
 * here out of the pane chain in `workspace-panes.tsx`, which is past the size a reader can take
 * in one go; the props reach each pane as they reached it there.
 */
export function WholePane({
  pane,
  commands,
  focused,
  focusSignal,
  archive,
  openInPane,
  logActions,
  onNotice,
  todos,
  onTodoPrompt,
  todoRow,
}: WholePaneProps) {
  if (pane.overview === true) {
    return (
      <OverviewPane
        commands={commands}
        focusSignal={focused ? focusSignal : 0}
        archive={archive}
        // Read at the render, so a tab left open across midnight redraws.
        today={readClock(new Date()).date}
      />
    );
  }
  if (pane.finance === true) {
    return (
      <FinancePane
        commands={commands}
        focusSignal={focused ? focusSignal : 0}
        onNotice={onNotice}
      />
    );
  }
  if (pane.log === true) {
    return (
      <LogPane
        commands={commands}
        onOpen={(path, hitLine) => void openInPane(path, hitLine)}
        focusSignal={focused ? focusSignal : 0}
        // The same clock the todo pane reads, for the same reason:
        // a tab left open across midnight shows yesterday until
        // something renders it.
        today={readClock(new Date()).date}
        actions={logActions}
        onNotice={onNotice}
      />
    );
  }
  if (pane.todos === true) {
    return (
      <TodoPane
        commands={commands}
        onOpen={(path, hitLine) => void openInPane(path, hitLine)}
        onCycle={todos.cycleTodo}
        onAdd={() => onTodoPrompt()}
        onSubtask={(hit) => onTodoPrompt(hit)}
        onEdit={todos.editTodo}
        onBlock={todos.blockTodo}
        onTimer={todos.toggleTimer}
        onAgent={(hit, twins) => void todos.agentTodo(hit, twins)}
        cursorRow={focused ? todoRow : undefined}
        onRefile={(hit, project) => void todos.refileTodo(hit, project)}
        onNotice={onNotice}
        archive={archive}
        focusSignal={focused ? focusSignal : 0}
        // Read at the render rather than inside the pane, which
        // stays a function of the strings it is handed. A tab left
        // open across midnight keeps yesterday's sections until
        // something makes it render, which is what the event stream
        // does the moment anything is written.
        today={readClock(new Date()).date}
      />
    );
  }
  return (
    <ReviewPane
      commands={commands}
      onClose={() => void commands.closeNote()}
      onOpen={(path, line) => void openInPane(path, line)}
      focusSignal={focused ? focusSignal : 0}
    />
  );
}
