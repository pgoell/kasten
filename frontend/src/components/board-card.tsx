import type { ReactNode } from "react";
import { chipNote, PersonChip } from "@/components/person-chip";
import type { Card } from "@/components/todo-board";
import { wordsOf } from "@/components/todo-row";
import type { SearchHit, TodoHit } from "@/lib/api";
import { isOpen, PRIORITY_SYMBOL, type Todo, type TodoState } from "@/lib/todo";
import type { Closed } from "@/lib/todo-blocked";
import { columnOf } from "@/lib/todo-board";
import { type Placed, waitsFor } from "@/lib/todo-view";
import { cardKey } from "@/lib/use-board-lanes";
import type { CardDrag } from "@/lib/use-card-drag";

/** The state each shifted key names, as the list's own table spells it. */
export const SET: Record<string, TodoState> = {
  O: "open",
  P: "doing",
  V: "review",
  X: "done",
  B: "blocked",
  W: "waiting",
  R: "rejected",
};

/** The keyboard cursor, the list's own. */
export const CURSOR = [
  "outline-1 -outline-offset-1 outline-k-accent/45",
  "focus:outline-2 focus:outline-k-accent",
].join(" ");

interface CardMetaProps {
  progress: string | undefined;
  blockers: string[];
  assignee: Todo["assignee"];
  files: string[];
}

/** The line under a card's words: its parts' progress, what it waits for, and who it is assigned to. */
function CardMeta({ progress, blockers, assignee, files }: CardMetaProps) {
  if (progress === undefined && blockers.length === 0 && assignee === undefined) return null;
  return (
    <span className="flex w-full gap-2 text-k-12 text-k-muted">
      {progress !== undefined && <span className="shrink-0">{progress}</span>}
      {blockers.length > 0 && (
        <span title={`waits for:\n${blockers.join("\n")}`} className="min-w-0 truncate">
          ⛔ {blockers.join(", ")}
        </span>
      )}
      {/* Beside the blockers, the one place the meta line has room for a chip. */}
      {assignee !== undefined && <PersonChip assignee={assignee} paths={files} />}
    </span>
  );
}

interface CardMoreProps {
  card: Card;
  more: string | null;
  onMore: (opening: string | null) => void;
  onCycle: (hit: SearchHit, state?: TodoState) => void;
  onProject: (hit: SearchHit) => void;
  onRefile: (hit: TodoHit) => void;
  /** The card's own face, drawn beside its `⋯`. */
  children: ReactNode;
}

/**
 * A card on a phone, with its `⋯` beside it. The strip it opens holds the states,
 * the project and the refile, since a finger has no drop target for those.
 */
function CardMore({ card, more, onMore, onCycle, onProject, onRefile, children }: CardMoreProps) {
  const { hit, todo } = card;
  const opening = `${cardKey(hit)}\n${hit.text}`;
  const opened = more === opening;
  // A state picked here is meant, so one tap sets it, as in the list's strip.
  const actions: [string, () => void][] = [
    ...Object.values(SET).map((state): [string, () => void] => [state, () => onCycle(hit, state)]),
    ["project", () => onProject(hit)],
    ["refile", () => onRefile(hit)],
  ];
  return (
    <div>
      <div className="flex">
        {children}
        <button
          type="button"
          tabIndex={-1}
          onClick={() => onMore(opened ? null : opening)}
          aria-label={`more for ${todo.text}`}
          aria-expanded={opened}
          className="min-h-11 min-w-11 shrink-0 text-k-muted"
        >
          ⋯
        </button>
      </div>
      {opened && (
        <div className="flex flex-wrap px-1 text-k-12 text-k-muted">
          {actions.map(([label, run]) => (
            <button
              key={label}
              type="button"
              tabIndex={-1}
              onClick={() => {
                onMore(null);
                run();
              }}
              aria-label={`${label} ${todo.text}`}
              className="min-h-11 px-3"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface BoardCardProps {
  card: Card;
  /** The lane the card is drawn in, which a drop from it is measured against. */
  lane: string;
  focused: boolean;
  /** Whether a finger or a mouse holds this card up for a drop. */
  lifted: boolean;
  coarse: boolean;
  /** The todo the card hangs off, shown above its words. */
  parent: Placed | undefined;
  /** `3/5` for a part's parent, if it has parts. */
  progress: string | undefined;
  named: Map<string, Todo>;
  closed: Closed;
  today: string;
  files: string[];
  drag: Pick<CardDrag<Card>, "grab" | "swallowed">;
  /** The `⋯` strip open on a phone, by the card's key and text. */
  more: string | null;
  onMore: (opening: string | null) => void;
  onOpen: (path: string, line: number) => void;
  onCycle: (hit: SearchHit, state?: TodoState) => void;
  onProject: (hit: SearchHit) => void;
  onRefile: (hit: TodoHit) => void;
}

/**
 * One todo on the board. On a phone a `⋯` opens the strip of states, the
 * project and the refile, since a finger has no drop target for those.
 */
export function BoardCard({
  card,
  lane,
  focused,
  lifted,
  coarse,
  parent,
  progress,
  named,
  closed,
  today,
  files,
  drag,
  more,
  onMore,
  onOpen,
  onCycle,
  onProject,
  onRefile,
}: BoardCardProps) {
  const { hit, todo } = card;
  const key = cardKey(hit);
  const blockers = waitsFor(todo, named, closed);
  // A due date before today reads red, the one thing on a card that asks for action.
  // Only open work asks for it, as the list's row reads it, so a finished card stays muted.
  const overdue = todo.due !== undefined && isOpen(todo) && todo.due < today;
  const face = (
    <button
      type="button"
      data-card={key}
      data-testid="todo-card"
      data-lifted={lifted ? "" : undefined}
      tabIndex={focused ? 0 : -1}
      onPointerDown={(event) => drag.grab(event, card, { lane, column: columnOf(todo) })}
      onClick={(event) => {
        if (drag.swallowed()) return;
        // A chip takes its own press: the person's note, from its first line.
        const note = chipNote(event.target);
        if (note === null) onOpen(hit.path, hit.line);
        else onOpen(note, 1);
      }}
      title={key}
      // The card sits on `paper`, not `surface`: the due date's red is measured on that ground.
      className={`flex min-w-0 cursor-pointer flex-col gap-0.5 ${coarse ? "flex-1" : "w-full"} rounded-[var(--k-radius-6)] border border-k-rule bg-k-paper px-2 py-1.5 text-left font-sans text-k-13 text-k-ink k-row ${focused ? CURSOR : ""} ${coarse ? "min-h-11 justify-center" : ""} ${lifted ? "opacity-40" : ""}`}
    >
      {parent !== undefined && (
        <span className="w-full truncate text-k-12 text-k-muted">↳ {parent.todo.text}</span>
      )}
      <span className="flex w-full gap-2">
        {todo.priority !== undefined && (
          <span className="shrink-0">{PRIORITY_SYMBOL[todo.priority]}</span>
        )}
        <span className="min-w-0 flex-1 truncate">{wordsOf(todo.text, todo.tags)}</span>
        {/* Cut as the list cuts it: the year only where it is not this one. */}
        {todo.due !== undefined && (
          <span className={`shrink-0 text-k-12 ${overdue ? "text-k-danger" : "text-k-muted"}`}>
            {todo.due.startsWith(today.slice(0, 4)) ? todo.due.slice(5) : todo.due}
          </span>
        )}
      </span>
      <CardMeta progress={progress} blockers={blockers} assignee={todo.assignee} files={files} />
    </button>
  );
  if (!coarse) return <div>{face}</div>;
  return (
    <CardMore
      card={card}
      more={more}
      onMore={onMore}
      onCycle={onCycle}
      onProject={onProject}
      onRefile={onRefile}
    >
      {face}
    </CardMore>
  );
}
