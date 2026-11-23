import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import {
  DayPick,
  FieldRow,
  InlineText,
  PriorityPick,
  ProjectPick,
  StatePick,
} from "@/components/todo/view/panel/panel-fields";
import { readMinutes } from "@/components/todo/view/panel/todo-panel";
import { Icon } from "@/components/todo/view/view-icons";
import type { TodoRow } from "@/lib/core/api";
import type { TodoState } from "@/lib/todo/todo";
import { newTodoOf, type QuickFields, readQuick, settled } from "@/lib/todo/view/rows/quick-words";
import { longDay, minutes } from "@/lib/todo/view/rows/row-facts";
import { addTodo, stateTodo } from "@/lib/todo/view/todo-store";

/** What a new todo starts with before anything is typed: its group's state, project or day. */
export interface Preset {
  state?: TodoState;
  project?: string | null;
  planned?: string;
}

/** The words with each field word marked, laid under the input so the marks sit on the words. */
function Marked({ text, tokens }: { text: string; tokens: { start: number; end: number }[] }) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const token of tokens) {
    parts.push(text.slice(at, token.start));
    parts.push(
      <mark key={token.start} className="rounded bg-k-highlight text-k-ink">
        {text.slice(token.start, token.end)}
      </mark>,
    );
    at = token.end;
  }
  parts.push(`${text.slice(at)}​`);
  return <>{parts}</>;
}

/**
 * A new todo in the side panel. Words like tomorrow, p2, #Haus and 30m fill the fields as
 * they are typed; a field picked by hand wins over the words. It lands in today's daily note.
 */
export function NewTodoPanel(props: {
  today: string;
  projects: string[];
  dailyNote: string;
  preset: Preset;
  onClose: () => void;
  onAdded: (row: TodoRow, next: boolean) => void;
  onNotice: (text: string) => void;
}) {
  const { today, projects } = props;
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [description, setDescription] = useState("");
  const [picked, setPicked] = useState<QuickFields & { state?: TodoState }>({});
  const [estimate, setEstimate] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const quick = readQuick(text, today, projects);
  const { fields, from } = settled(quick, picked, props.preset);
  const state = picked.state ?? props.preset.state ?? "open";

  async function add(next: boolean) {
    if (quick.words.trim() === "" || adding) return;
    setAdding(true);
    try {
      const row = await addTodo(queryClient, newTodoOf(quick, fields, description));
      if (state !== "open") await stateTodo(queryClient, row.id, state);
      setText("");
      setDescription("");
      setPicked({});
      setEstimate(null);
      props.onAdded(row, next);
    } catch (error) {
      props.onNotice(`Not added: ${error instanceof Error ? error.message : error}`);
    } finally {
      setAdding(false);
    }
  }

  return (
    <aside aria-label="New todo" className="flex h-full min-h-0 flex-col bg-k-bg">
      <div className="flex items-center gap-2 px-6 pt-4 text-k-link">
        <Icon name="plus" />
        <span className="font-medium text-[15px]">New todo</span>
        <button
          type="button"
          aria-label="Close"
          onClick={props.onClose}
          className="ml-auto rounded p-1 text-k-muted hover:bg-k-inset hover:text-k-ink"
        >
          <Icon name="x" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">
        <div className="relative mt-2 border-k-accent border-b-2 pb-1 font-serif text-[28px] leading-tight">
          <div aria-hidden="true" className="whitespace-pre-wrap break-words text-k-ink">
            <Marked text={text} tokens={quick.tokens} />
          </div>
          <textarea
            aria-label="Words"
            data-panel-title
            // biome-ignore lint/a11y/noAutofocus: the panel opens to be typed into.
            autoFocus
            value={text}
            placeholder="What is there to do?"
            onChange={(event) => setText(event.target.value.replace(/\n/g, " "))}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              void add(event.shiftKey);
            }}
            className="absolute inset-0 resize-none overflow-hidden bg-transparent text-transparent caret-k-ink outline-none placeholder:text-k-muted"
          />
        </div>
        <textarea
          aria-label="Description"
          value={description}
          placeholder="Add a description, [[ links a note"
          onChange={(event) => setDescription(event.target.value)}
          className="field-sizing-content mt-3 min-h-11 w-full resize-none rounded-md border border-k-rule bg-k-paper px-3 py-2 text-[15px] text-k-ink outline-none placeholder:text-k-muted"
        />
        <NewFields
          today={today}
          projects={projects}
          state={state}
          fields={fields}
          from={from}
          estimate={estimate}
          onEstimate={setEstimate}
          onPick={(set) => setPicked({ ...picked, ...set })}
        />
        <section aria-label="Notes" className="mt-3 border-k-rule border-t pt-3">
          <h3 className="mb-1 font-semibold text-[15px] text-k-ink">Notes</h3>
          <div className="flex min-h-9 items-center gap-2.5">
            <Icon name="doc" className="text-k-muted" />
            <span className="text-k-link">
              {props.dailyNote.slice(props.dailyNote.lastIndexOf("/") + 1).replace(/\.md$/, "")}
            </span>
            <span className="ml-auto text-k-muted text-sm">will live in today's note</span>
          </div>
        </section>
      </div>
      <div className="flex items-center gap-3 border-k-rule border-t px-6 py-3">
        <span className="text-k-muted text-sm">
          <kbd className="rounded border border-k-rule px-1 font-mono text-xs">Esc</kbd> cancel
        </span>
        <button
          type="button"
          onClick={() => void add(true)}
          className="ml-auto rounded-md bg-k-inset px-3 py-1.5 font-medium text-k-ink text-sm"
        >
          Add and next
        </button>
        <button
          type="button"
          onClick={() => void add(false)}
          className="rounded-md bg-k-accent px-3 py-1.5 font-medium text-k-bg text-sm"
        >
          Add
        </button>
      </div>
    </aside>
  );
}

/** The new todo's field list, each field marked where the words gave it. */
function NewFields(props: {
  today: string;
  projects: string[];
  state: TodoState;
  fields: QuickFields;
  from: Set<keyof QuickFields>;
  estimate: string | null;
  onEstimate: (typed: string) => void;
  onPick: (set: QuickFields & { state?: TodoState }) => void;
}) {
  const { today, projects, state, fields, from, estimate, onEstimate, onPick } = props;
  return (
    <div className="mt-3 border-k-rule border-t pt-3">
      <FieldRow icon="check" label="State">
        <StatePick state={state} onPick={(next) => onPick({ state: next })} />
      </FieldRow>
      <FieldRow icon="text" label="Project" from={from.has("project")}>
        <ProjectPick
          project={fields.project ?? null}
          projects={projects}
          onPick={(project) => onPick({ project: project ?? undefined })}
        />
      </FieldRow>
      <FieldRow icon="bars" label="Priority" from={from.has("priority")}>
        <PriorityPick
          priority={fields.priority ?? null}
          onPick={(priority) =>
            onPick({ priority: (priority ?? undefined) as QuickFields["priority"] })
          }
        />
      </FieldRow>
      <FieldRow icon="sun" label="Planned" from={from.has("planned")}>
        <DayPick
          label="Planned"
          day={fields.planned ?? null}
          shown={fields.planned ? longDay(fields.planned, today) : ""}
          empty="Plan a day"
          onPick={(day) => onPick({ planned: day ?? undefined })}
        />
      </FieldRow>
      <FieldRow icon="flag" label="Due" from={from.has("due")}>
        <DayPick
          label="Due"
          day={fields.due ?? null}
          shown={fields.due ? longDay(fields.due, today) : ""}
          empty="Set a due date"
          onPick={(day) => onPick({ due: day ?? undefined })}
        />
      </FieldRow>
      <FieldRow icon="clock" label="Time" from={from.has("estimate")}>
        <InlineText
          label="Estimate"
          value={
            estimate ??
            (fields.estimate === undefined ? "" : `${minutes(fields.estimate)} estimated`)
          }
          placeholder="Estimate, as 2h or 45m"
          onText={(typed) => {
            onEstimate(typed);
            const read = readMinutes(typed);
            if (read !== undefined) onPick({ estimate: read ?? undefined });
          }}
        />
      </FieldRow>
      <FieldRow icon="repeat" label="Repeat" from={from.has("repeat")}>
        <InlineText
          label="Repeat"
          value={fields.repeat ?? ""}
          placeholder="Never"
          onText={(typed) => onPick({ repeat: typed === "" ? undefined : typed })}
        />
      </FieldRow>
    </div>
  );
}
