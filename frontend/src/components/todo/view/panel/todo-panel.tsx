import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  DateButton,
  FieldRow,
  InlineText,
  PriorityPick,
  ProjectPick,
  StatePick,
} from "@/components/todo/view/panel/panel-fields";
import { PanelNotes, PanelParts } from "@/components/todo/view/panel/panel-sections";
import { DatePick, type Which } from "@/components/todo/view/pick/date-pick";
import { NotePick } from "@/components/todo/view/pick/note-pick";
import { Icon } from "@/components/todo/view/view-icons";
import type { TodoRow } from "@/lib/core/api";
import { linkTo } from "@/lib/todo/view/rows/note-links";
import { readMinutes } from "@/lib/todo/view/rows/quick-words";
import { longDay, minutes } from "@/lib/todo/view/rows/row-facts";
import { deleteTodo, stateTodo, timerTodo } from "@/lib/todo/view/todo-store";
import { usePanelSave } from "@/lib/todo/view/use-panel-save";

export interface PanelProps {
  row: TodoRow;
  parts: TodoRow[];
  projects: string[];
  files: string[] | undefined;
  today: string;
  running: boolean;
  /** Counts the view's `n` presses; each new count opens the note picker. */
  linkAsk: number;
  onClose: () => void;
  onOpenTodo: (id: string) => void;
  onOpenNote: (path: string) => void;
  onNotice: (text: string) => void;
}

/**
 * One todo in the side panel, every field editable and saved as it is typed. Keyed by the
 * todo's id, so what is typed belongs to the todo it was typed on.
 */
export function TodoPanel(props: PanelProps) {
  const { row, today, onNotice } = props;
  const queryClient = useQueryClient();
  const { save, state: saving } = usePanelSave(row.id, (why) => onNotice(`Not saved: ${why}`));
  const [words, setWords] = useState(row.words);
  const [description, setDescription] = useState(row.description ?? "");
  const [estimate, setEstimate] = useState(
    row.estimate === null ? "" : minutes(row.estimate).replace(/ /g, ""),
  );
  const [repeat, setRepeat] = useState(row.repeat ?? "");
  const [deleting, setDeleting] = useState(false);
  const [dates, setDates] = useState<{ which: Which; anchor: HTMLElement } | null>(null);
  const [linking, setLinking] = useState<HTMLElement | null>(null);
  const describe = (text: string) => {
    setDescription(text);
    save({ description: text === "" ? null : text });
  };
  // Where a `[[` was just typed: the link replaces it there. Without one it starts a line.
  const linkAt = useRef<number | null>(null);
  const linkNote = (path: string) => {
    const link = linkTo(path, props.files ?? []);
    const at = linkAt.current;
    linkAt.current = null;
    if (at !== null && description.slice(at - 2, at) === "[[")
      describe(`${description.slice(0, at - 2)}${link}${description.slice(at)}`);
    else describe(description.trim() === "" ? link : `${description.trimEnd()}\n${link}`);
  };
  const aside = useRef<HTMLElement>(null);
  const firstAsk = useRef(props.linkAsk);
  useEffect(() => {
    if (props.linkAsk === firstAsk.current) return;
    setLinking(aside.current?.querySelector<HTMLElement>("[data-link-note]") ?? null);
  }, [props.linkAsk]);
  const failed = (error: unknown) =>
    onNotice(`Not saved: ${error instanceof Error ? error.message : error}`);
  const worked = row.worked ?? 0;

  return (
    <aside ref={aside} aria-label="Todo" className="flex h-full min-h-0 flex-col bg-k-bg">
      {linking !== null && (
        <NotePick
          anchor={linking}
          files={props.files ?? []}
          onPick={linkNote}
          onClose={() => {
            linkAt.current = null;
            setLinking(null);
          }}
        />
      )}
      {dates !== null && (
        <DatePick
          anchor={dates.anchor}
          dates={row}
          today={today}
          start={dates.which}
          onSet={(change) => save(change, true)}
          onClose={() => setDates(null)}
        />
      )}
      <div className="flex items-center gap-2 px-6 pt-4">
        <ProjectPick
          project={row.project}
          projects={props.projects}
          onPick={(project) => save({ project }, true)}
        />
        <span className="ml-auto" />
        {deleting ? (
          <button
            type="button"
            onClick={() => void deleteTodo(queryClient, row.id).then(props.onClose, failed)}
            className="rounded bg-k-danger px-2 py-0.5 text-k-bg text-sm"
          >
            Delete it and its parts
          </button>
        ) : (
          <button
            type="button"
            aria-label="Delete todo"
            onClick={() => setDeleting(true)}
            className="rounded p-1 text-k-muted hover:bg-k-inset hover:text-k-ink"
          >
            <Icon name="more" />
          </button>
        )}
        <button
          type="button"
          aria-label="Close"
          onClick={props.onClose}
          className="rounded p-1 text-k-muted hover:bg-k-inset hover:text-k-ink"
        >
          <Icon name="x" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">
        <textarea
          aria-label="Words"
          data-panel-title
          rows={1}
          value={words}
          onChange={(event) => {
            const typed = event.target.value.replace(/\n/g, " ");
            setWords(typed);
            if (typed.trim() !== "") save({ words: typed.trim() });
          }}
          className="field-sizing-content mt-2 w-full resize-none border-k-accent border-b-2 bg-transparent pb-1 font-serif text-[28px] text-k-ink leading-tight outline-none"
        />
        <textarea
          aria-label="Description"
          value={description}
          placeholder="Add a description, [[ links a note"
          onChange={(event) => {
            const { value, selectionStart: at } = event.target;
            const typed = value.length > description.length && value.slice(at - 2, at) === "[[";
            describe(value);
            linkAt.current = typed ? at : null;
            if (typed) setLinking(event.target);
          }}
          className="field-sizing-content mt-3 min-h-12 w-full resize-none rounded-md border border-k-rule bg-k-paper px-3 py-2 text-[15px] text-k-ink leading-relaxed outline-none placeholder:text-k-muted focus:border-k-rule-strong"
        />

        <div className="mt-3 border-k-rule border-t pt-3">
          <FieldRow icon="check" label="State">
            <StatePick
              state={row.state}
              onPick={(next) => void stateTodo(queryClient, row.id, next).catch(failed)}
            />
          </FieldRow>
          <FieldRow icon="bars" label="Priority">
            <PriorityPick
              priority={row.priority}
              onPick={(priority) => save({ priority: priority as TodoRow["priority"] }, true)}
            />
          </FieldRow>
          <DateRows
            row={row}
            today={today}
            onOpen={(which, anchor) => setDates({ which, anchor })}
          />
          <FieldRow icon="clock" label="Time">
            {worked > 0 && <span className="shrink-0 text-k-ink">{minutes(worked)} of</span>}
            <InlineText
              label="Estimate"
              value={estimate}
              placeholder="Estimate, as 2h or 45m"
              onText={(text) => {
                setEstimate(text);
                const read = readMinutes(text);
                if (read !== undefined) save({ estimate: read });
              }}
            />
            <button
              type="button"
              onClick={() => void timerTodo(queryClient, row.id).catch(failed)}
              className="flex shrink-0 items-center gap-1 rounded-full bg-k-inset px-2.5 py-0.5 text-k-ink-soft text-sm hover:text-k-ink"
            >
              <Icon name={props.running ? "x" : "play"} className="size-3" />
              {props.running ? "Stop" : "Start"}
            </button>
          </FieldRow>
          <FieldRow icon="repeat" label="Repeat">
            <InlineText
              label="Repeat"
              value={repeat}
              placeholder="Never"
              onText={(text) => {
                setRepeat(text);
                save({ repeat: text.trim() === "" ? null : text.trim() });
              }}
            />
          </FieldRow>
          <FieldRow icon="tag" label="Tags">
            {row.tags.length === 0 ? (
              <span className="text-k-muted">Type a #tag in the words</span>
            ) : (
              row.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-k-inset px-2.5 py-0.5 text-k-ink-soft text-sm"
                >
                  {tag}
                </span>
              ))
            )}
          </FieldRow>
        </div>

        <PanelNotes
          row={row}
          words={words}
          description={description}
          files={props.files}
          onOpenNote={props.onOpenNote}
          onLink={setLinking}
        />
        <PanelParts
          parent={row}
          parts={props.parts}
          onOpenTodo={props.onOpenTodo}
          onNotice={onNotice}
        />
      </div>

      <div className="flex items-center gap-3 border-k-rule border-t px-6 py-3 text-k-muted text-sm">
        <span aria-live="polite">
          {saving === "saving"
            ? "Saving…"
            : saving === "failed"
              ? "Not saved"
              : "Saved as you type"}
        </span>
        <span className="ml-auto">
          <kbd className="rounded border border-k-rule px-1 font-mono text-xs">Esc</kbd> close
        </span>
      </div>
    </aside>
  );
}

/** Planned, due and hold until, each opening the one date popover on its own tab. */
function DateRows(props: {
  row: TodoRow;
  today: string;
  onOpen: (which: Which, anchor: HTMLElement) => void;
}) {
  const { row, today } = props;
  const shown = (day: string | null) => (day === null ? "" : longDay(day, today));
  return (
    <>
      <FieldRow icon="sun" label="Planned">
        <DateButton
          label="Planned"
          day={row.planned}
          shown={shown(row.planned)}
          empty="Plan a day"
          onOpen={(anchor) => props.onOpen("planned", anchor)}
        />
      </FieldRow>
      <FieldRow icon="flag" label="Due">
        <DateButton
          label="Due"
          day={row.due_hard ? row.due : null}
          shown={shown(row.due)}
          empty="Set a due date"
          onOpen={(anchor) => props.onOpen("due", anchor)}
        />
      </FieldRow>
      <FieldRow icon="hour" label="Hold until">
        <DateButton
          label="Hold until"
          day={row.hold_until}
          shown={shown(row.hold_until)}
          empty="Not held"
          onOpen={(anchor) => props.onOpen("hold_until", anchor)}
        />
      </FieldRow>
    </>
  );
}
