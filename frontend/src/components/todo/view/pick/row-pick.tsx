import { useQueryClient } from "@tanstack/react-query";
import { TodoStateBox } from "@/components/todo/todo-state-box";
import { nameOf, PRIORITIES, STATES } from "@/components/todo/view/panel/panel-fields";
import { DatePick } from "@/components/todo/view/pick/date-pick";
import { ListPick } from "@/components/todo/view/pick/list-pick";
import { PriorityBars } from "@/components/todo/view/view-icons";
import type { TodoChange, TodoRow } from "@/lib/core/api";
import { changeTodo, stateTodo } from "@/lib/todo/view/todo-store";

export type PickKind = "date" | "state" | "priority";

/** The popover a key opened on a table row, writing what is picked straight to the store. */
export function RowPick(props: {
  kind: PickKind;
  row: TodoRow;
  anchor: HTMLElement | null;
  today: string;
  onClose: () => void;
  onNotice: (text: string) => void;
}) {
  const { row, anchor, onClose } = props;
  const queryClient = useQueryClient();
  const failed = (error: unknown) =>
    props.onNotice(`Not saved: ${error instanceof Error ? error.message : error}`);
  const change = (fields: Omit<TodoChange, "version">) =>
    void changeTodo(queryClient, row.id, fields).catch(failed);

  if (props.kind === "date") {
    return (
      <DatePick
        anchor={anchor}
        dates={row}
        today={props.today}
        start="planned"
        onSet={change}
        onClose={onClose}
      />
    );
  }
  if (props.kind === "state") {
    return (
      <ListPick
        label="State"
        anchor={anchor}
        current={row.state}
        choices={STATES.map((state) => ({
          value: state,
          label: nameOf(state),
          icon: <TodoStateBox state={state} />,
        }))}
        onPick={(state) => void stateTodo(queryClient, row.id, state).catch(failed)}
        onClose={onClose}
      />
    );
  }
  return (
    <ListPick<TodoRow["priority"]>
      label="Priority"
      anchor={anchor}
      current={row.priority}
      choices={[
        ...PRIORITIES.map((priority) => ({
          value: priority,
          label: nameOf(priority),
          icon: <PriorityBars priority={priority} />,
        })),
        { value: null, label: "None", icon: <PriorityBars priority={null} /> },
      ]}
      onPick={(priority) => change({ priority })}
      onClose={onClose}
    />
  );
}
