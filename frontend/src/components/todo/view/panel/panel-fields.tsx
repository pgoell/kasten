import type { ReactNode } from "react";
import { TodoStateBox } from "@/components/todo/todo-state-box";
import { Icon, type IconName } from "@/components/todo/view/view-icons";
import type { TodoState } from "@/lib/todo/todo";
import { projectHue } from "@/lib/todo/view/rows/row-facts";
import { projectName } from "@/lib/todo/view/rows/view-rows";

export const STATES: TodoState[] = [
  "open",
  "doing",
  "review",
  "waiting",
  "blocked",
  "done",
  "rejected",
];
export const PRIORITIES = ["highest", "high", "medium", "low", "lowest"] as const;

const LABEL: Record<string, string> = {
  open: "Open",
  doing: "Doing",
  review: "Review",
  waiting: "Waiting",
  blocked: "Blocked",
  done: "Done",
  rejected: "Rejected",
  highest: "Highest",
  high: "High",
  medium: "Medium",
  low: "Low",
  lowest: "Lowest",
};

export const nameOf = (value: string) => LABEL[value] ?? value;

/** One line of the panel's field list: an icon, the field's name, its value. */
export function FieldRow(props: {
  icon: IconName;
  label: string;
  children: ReactNode;
  from?: boolean;
}) {
  return (
    <div className="grid min-h-10 grid-cols-[22px_100px_minmax(0,1fr)] items-center gap-2 text-[15px]">
      <Icon name={props.icon} className="text-k-muted" />
      <span className="text-k-ink-soft">{props.label}</span>
      <span className="flex min-w-0 items-center gap-2">
        {props.children}
        {props.from && (
          <span className="rounded-full border border-k-rule px-2 text-k-muted text-xs">
            from the words
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * A value that is also a picker: the value drawn plainly, a native select laid over it,
 * so the keyboard and a phone's own picker both work.
 */
export function Pick<T extends string>(props: {
  label: string;
  value: T | "";
  options: readonly { value: T | ""; label: string }[];
  onPick: (value: T | "") => void;
  children: ReactNode;
}) {
  return (
    <span className="relative inline-flex items-center rounded px-1 hover:bg-k-inset">
      {props.children}
      <select
        aria-label={props.label}
        value={props.value}
        onChange={(event) => props.onPick(event.target.value as T | "")}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  );
}

export function StatePick({
  state,
  onPick,
}: {
  state: TodoState;
  onPick: (state: TodoState) => void;
}) {
  return (
    <Pick
      label="State"
      value={state}
      options={STATES.map((value) => ({ value, label: nameOf(value) }))}
      onPick={(value) => value !== "" && onPick(value)}
    >
      <span className="flex items-center gap-2 text-k-ink">
        <TodoStateBox state={state} />
        {nameOf(state)}
      </span>
    </Pick>
  );
}

const PRIORITY_TONE: Record<string, string> = {
  highest: "text-k-danger",
  high: "text-k-warn",
  medium: "text-k-info",
};

export function PriorityPick(props: {
  priority: string | null;
  onPick: (priority: string | null) => void;
}) {
  return (
    <Pick
      label="Priority"
      value={props.priority ?? ""}
      options={[
        { value: "", label: "None" },
        ...PRIORITIES.map((value) => ({ value, label: nameOf(value) })),
      ]}
      onPick={(value) => props.onPick(value === "" ? null : value)}
    >
      {props.priority === null ? (
        <span className="text-k-muted">Set a priority</span>
      ) : (
        <span className={PRIORITY_TONE[props.priority] ?? "text-k-ink"}>
          {nameOf(props.priority)}
        </span>
      )}
    </Pick>
  );
}

export function ProjectPick(props: {
  project: string | null;
  projects: string[];
  onPick: (project: string | null) => void;
}) {
  return (
    <Pick
      label="Project"
      value={props.project ?? ""}
      options={[
        { value: "", label: "No project" },
        ...props.projects.map((value) => ({ value, label: projectName(value) })),
      ]}
      onPick={(value) => props.onPick(value === "" ? null : value)}
    >
      <span className="flex items-center gap-2 text-k-ink">
        <span className="size-2 rounded-full" style={{ background: projectHue(props.project) }} />
        {projectName(props.project)}
        <Icon name="down" className="text-k-muted" />
      </span>
    </Pick>
  );
}

/** A day drawn as its text; a press opens the date popover by it. */
export function DateButton(props: {
  label: string;
  day: string | null;
  shown: string;
  empty: string;
  onOpen: (anchor: HTMLElement) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`${props.label}: ${props.day === null ? props.empty : props.shown}`}
      onClick={(event) => props.onOpen(event.currentTarget)}
      className={`rounded px-1 text-left hover:bg-k-inset ${props.day === null ? "text-k-muted" : "text-k-ink"}`}
    >
      {props.day === null ? props.empty : props.shown}
    </button>
  );
}

/** A short text field drawn as its value until focused, saved as typed. */
export function InlineText(props: {
  label: string;
  value: string;
  placeholder: string;
  onText: (text: string) => void;
}) {
  return (
    <input
      aria-label={props.label}
      value={props.value}
      placeholder={props.placeholder}
      onChange={(event) => props.onText(event.target.value)}
      className="min-w-0 flex-1 rounded bg-transparent px-1 text-k-ink outline-none placeholder:text-k-muted hover:bg-k-inset focus:bg-k-inset"
    />
  );
}
