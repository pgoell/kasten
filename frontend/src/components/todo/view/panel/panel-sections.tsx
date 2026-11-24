import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { TodoStateBox } from "@/components/todo/todo-state-box";
import { Icon } from "@/components/todo/view/view-icons";
import type { TodoRow } from "@/lib/core/api";
import { noteName } from "@/lib/notes/links/note-path";
import { namesAFile } from "@/lib/notes/links/wikilink";
import { linkedNotes } from "@/lib/todo/view/rows/note-links";
import { addTodo, stateTodo } from "@/lib/todo/view/todo-store";

/** The panel's Notes: the note the todo lives in, then each note its words or description link to. */
export function PanelNotes(props: {
  row: TodoRow;
  words: string;
  description: string;
  files: string[] | undefined;
  onOpenNote: (path: string) => void;
  onLink: (anchor: HTMLElement) => void;
}) {
  const { row, files = [] } = props;
  const linked = linkedNotes(`${props.words}\n${props.description}`, files).filter(
    (path) => path !== row.note,
  );
  const count = linked.length + (row.note === null ? 0 : 1);
  return (
    <section aria-label="Notes" className="mt-3 border-k-rule border-t pt-3">
      <h3 className="mb-1 font-semibold text-[15px] text-k-ink">
        Notes <span className="ml-1 font-normal text-k-muted">{count}</span>
      </h3>
      {row.note !== null && (
        <NoteLine icon="doc" path={row.note} why="lives here" onOpen={props.onOpenNote} />
      )}
      {linked.map((path) => (
        <NoteLine
          key={path}
          icon="link"
          path={path}
          why={files.includes(path) || namesAFile(path) ? "from the text" : "not written yet"}
          onOpen={props.onOpenNote}
        />
      ))}
      <button
        type="button"
        data-link-note
        onClick={(event) => props.onLink(event.currentTarget)}
        className="flex min-h-9 items-center gap-2.5 text-k-ink-soft hover:text-k-ink"
      >
        <Icon name="plus" className="text-k-muted" />
        Link a note
        <kbd className="rounded border border-k-rule px-1.5 font-mono text-k-muted text-xs">n</kbd>
      </button>
    </section>
  );
}

function NoteLine(props: {
  icon: "doc" | "link";
  path: string;
  why: string;
  onOpen: (path: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => props.onOpen(props.path)}
      className="group flex min-h-9 w-full items-center gap-2.5 text-left"
    >
      <Icon name={props.icon} className="text-k-muted" />
      <span className="truncate text-k-link group-hover:underline">{noteName(props.path)}</span>
      <span className="ml-auto shrink-0 text-k-muted text-sm">{props.why}</span>
      <Icon name="open" className="text-k-muted" />
    </button>
  );
}

/** The panel's Parts: each part ticks or opens, and a line at the end adds one. */
export function PanelParts(props: {
  parent: TodoRow;
  parts: TodoRow[];
  onOpenTodo: (id: string) => void;
  onNotice: (text: string) => void;
}) {
  const queryClient = useQueryClient();
  const [typed, setTyped] = useState("");
  const failed = (error: unknown) =>
    props.onNotice(`Not saved: ${error instanceof Error ? error.message : error}`);
  return (
    <section aria-label="Parts" className="mt-3 border-k-rule border-t pt-3">
      <h3 className="mb-1 font-semibold text-[15px] text-k-ink">Parts</h3>
      {props.parts.map((part) => (
        <PartLine
          key={part.id}
          part={part}
          onTick={() =>
            void stateTodo(queryClient, part.id, part.state === "done" ? "open" : "done").catch(
              failed,
            )
          }
          onOpen={() => props.onOpenTodo(part.id)}
        />
      ))}
      <label className="flex min-h-9 items-center gap-2.5 text-k-muted">
        <Icon name="plus" />
        <input
          aria-label="Add part"
          value={typed}
          placeholder="Add part"
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || typed.trim() === "") return;
            event.preventDefault();
            const words = typed.trim();
            setTyped("");
            void addTodo(queryClient, { words, parent_id: props.parent.id }).catch(failed);
          }}
          className="min-w-0 flex-1 bg-transparent text-k-ink outline-none placeholder:text-k-muted"
        />
      </label>
    </section>
  );
}

/** A part's line in the panel: its box ticks it, its words open it. */
function PartLine({
  part,
  onTick,
  onOpen,
}: {
  part: TodoRow;
  onTick: () => void;
  onOpen: () => void;
}) {
  const done = part.state === "done" || part.state === "rejected";
  return (
    <div className="flex min-h-9 items-center gap-2.5">
      <button
        type="button"
        aria-label={done ? "Open again" : "Done"}
        onClick={onTick}
        className="rounded-full p-0.5 hover:bg-k-rule"
      >
        <TodoStateBox state={part.state} />
      </button>
      <button
        type="button"
        onClick={onOpen}
        className={`truncate text-left ${done ? "text-k-muted line-through" : "text-k-ink"}`}
      >
        {part.words}
      </button>
    </div>
  );
}
