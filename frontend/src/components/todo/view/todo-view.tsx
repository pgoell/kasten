import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { NewTodoPanel, type Preset } from "@/components/todo/view/panel/new-todo-panel";
import { TodoPanel } from "@/components/todo/view/panel/todo-panel";
import { type PickKind, RowPick } from "@/components/todo/view/pick/row-pick";
import { TodoTable } from "@/components/todo/view/todo-table";
import { Icon } from "@/components/todo/view/view-icons";
import { WeekStrip } from "@/components/todo/view/week-strip";
import type { TodoRow } from "@/lib/core/api";
import { periodicNote } from "@/lib/notes/text/periodic";
import {
  countOf,
  type Group,
  type GroupBy,
  groupsOf,
  TABS,
  type Tab,
} from "@/lib/todo/view/rows/view-rows";
import { stateTodo } from "@/lib/todo/view/todo-store";
import { useTodoData } from "@/lib/todo/view/use-todo-data";
import { useViewKeys } from "@/lib/todo/view/use-view-keys";
import type { EditorCommands } from "@/lib/ui/keys/key-bindings";

type Panel = { kind: "todo"; id: string } | { kind: "new"; preset: Preset } | null;

/** Below this width the panel takes the pane's place instead of sitting beside the table. */
const SIDE_BY_SIDE = 900;

/** The row `step` rows on from the cursor, held at the ends; the first row with no cursor. */
function stepFrom(lines: string[], cursor: string | null, step: number): string | undefined {
  const at = cursor === null ? -1 : lines.indexOf(cursor);
  return lines[Math.min(Math.max(at + step, 0), lines.length - 1)];
}

/** Done, or open again for a todo already closed. */
function tickTodo(queryClient: QueryClient, row: TodoRow, onNotice: (text: string) => void) {
  const next = row.state === "done" || row.state === "rejected" ? "open" : "done";
  stateTodo(queryClient, row.id, next).catch((error: unknown) =>
    onNotice(`Not saved: ${error instanceof Error ? error.message : error}`),
  );
}

function useWidth() {
  const ref = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(Number.POSITIVE_INFINITY);
  useEffect(() => {
    const node = ref.current;
    if (node === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

export interface TodoViewProps {
  commands: EditorCommands;
  onOpen: (path: string) => void;
  onNotice: (text: string) => void;
  focusSignal: number;
  /** Read by the route at each render, so a tab left open across midnight moves on. */
  today: string;
  archive?: boolean;
  /** The board, drawn by its own pane under the Board tab. */
  board: ReactNode;
}

/**
 * The todo pane: a dense table grouped by state, every edit in a side panel that saves as it
 * is typed. The Board tab keeps the board as it was.
 */
export function TodoView(props: TodoViewProps) {
  const { today, onNotice } = props;
  const queryClient = useQueryClient();
  const data = useTodoData(props.archive ?? false);
  const { ref: pane, width } = useWidth();
  const [tab, setTab] = useState<Tab | "board">("today");
  const [by, setBy] = useState<GroupBy>("state");
  const [typed, setTyped] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [pop, setPop] = useState<{ kind: PickKind; id: string } | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const filter = useRef<HTMLInputElement>(null);
  const board = useRef<HTMLDivElement>(null);
  const listTab: Tab = tab === "board" ? "today" : tab;
  const groups = useMemo(
    () => groupsOf(data.rows, { tab: listTab, by, today, words: typed }),
    [data.rows, listTab, by, today, typed],
  );
  const lines = groups.flatMap((group) => group.lines.map((line) => line.row.id));
  const shown = panel?.kind === "todo" ? data.byId.get(panel.id) : undefined;
  const panelOpen = panel?.kind === "new" || shown !== undefined;

  useEffect(() => {
    if (props.focusSignal) pane.current?.focus();
  }, [props.focusSignal, pane]);

  const openTodo = (id: string) => {
    setCursor(id);
    setPanel({ kind: "todo", id });
  };
  const close = () => {
    setPanel(null);
    pane.current?.focus();
  };
  const tick = (row: TodoRow) => tickTodo(queryClient, row, onNotice);
  const newIn = (group?: Group) =>
    setPanel({
      kind: "new",
      preset: { state: group?.state, project: group?.project, planned: group?.day },
    });
  const toDay = (picked: string) => {
    setDay(picked);
    pane.current?.querySelector(`[data-group="${picked}"]`)?.scrollIntoView?.({ block: "start" });
  };
  const switchTab = (next: Tab | "board") => {
    setTab(next);
    // Upcoming reads by day; leaving it, the day grouping has nothing to stand on.
    if (next === "upcoming") setBy("day");
    else if (by === "day") setBy("state");
    // The board takes its keys at once, as the list did when `<leader>gt` opened it.
    if (next === "board")
      requestAnimationFrame(() => board.current?.querySelector<HTMLElement>("section")?.focus());
  };
  const atCursor = cursor === null ? undefined : data.byId.get(cursor);

  const onKeyDown = useViewKeys(
    props.commands,
    {
      move(step) {
        const next = stepFrom(lines, cursor, step);
        if (next === undefined) return;
        setCursor(next);
        if (panel?.kind === "todo") setPanel({ kind: "todo", id: next });
        pane.current
          ?.querySelector(`[data-todo="${next}"]`)
          ?.scrollIntoView?.({ block: "nearest" });
      },
      edit() {
        if (atCursor === undefined) return;
        openTodo(atCursor.id);
        requestAnimationFrame(() =>
          pane.current?.querySelector<HTMLElement>("[data-panel-title]")?.focus(),
        );
      },
      tick: () => atCursor && tick(atCursor),
      add: () => newIn(),
      filter: () => filter.current?.focus(),
      goToNote: () => atCursor?.note && props.onOpen(atCursor.note),
      // Only on a row drawn now: a popover with no row to sit by would take keys unseen.
      pick: (kind) =>
        atCursor &&
        pane.current?.querySelector(`[data-todo="${atCursor.id}"]`) &&
        setPop({ kind, id: atCursor.id }),
      close() {
        if (panel === null) return false;
        close();
        return true;
      },
    },
    tab === "board",
  );

  const panelNode = (
    <PanelSlot
      panel={panel}
      shown={shown}
      data={data}
      today={today}
      onClose={close}
      onNew={(preset) => setPanel({ kind: "new", preset })}
      onOpenTodo={openTodo}
      onOpenNote={props.onOpen}
      onNotice={onNotice}
    />
  );

  return (
    <section
      ref={pane}
      aria-label="Todos"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="flex h-full min-h-0 flex-col bg-k-bg font-sans outline-none"
    >
      <Toolbar
        tab={tab}
        onTab={switchTab}
        counts={(each) => countOf(data.rows, each, today)}
        filter={filter}
        typed={typed}
        onTyped={setTyped}
        onDone={() => pane.current?.focus()}
        by={by}
        onBy={setBy}
        onNew={() => newIn()}
      />
      {tab === "board" ? (
        <div ref={board} className="min-h-0 flex-1">
          {props.board}
        </div>
      ) : (
        <Split narrow={width < SIDE_BY_SIDE} panel={panelOpen ? panelNode : null}>
          {tab === "upcoming" && by === "day" && (
            <WeekStrip rows={data.rows} today={today} words={typed} picked={day} onDay={toDay} />
          )}
          <TodoTable
            groups={groups}
            empty={data.loaded ? "Nothing to do here." : ""}
            byId={data.byId}
            today={today}
            cursor={cursor}
            open={panel?.kind === "todo" ? panel.id : null}
            onOpen={openTodo}
            onTick={tick}
            onNew={newIn}
          />
          <KeyHints />
        </Split>
      )}
      {pop !== null && (
        <PopSlot
          pop={pop}
          row={data.byId.get(pop.id)}
          pane={pane.current}
          today={today}
          onClose={() => {
            setPop(null);
            pane.current?.focus();
          }}
          onNotice={onNotice}
        />
      )}
    </section>
  );
}

/** The popover a key opened on the row it was opened on, while that row is still listed. */
function PopSlot(props: {
  pop: { kind: PickKind; id: string };
  row: TodoRow | undefined;
  pane: HTMLElement | null;
  today: string;
  onClose: () => void;
  onNotice: (text: string) => void;
}) {
  if (props.row === undefined) return null;
  return (
    <RowPick
      kind={props.pop.kind}
      row={props.row}
      anchor={props.pane?.querySelector<HTMLElement>(`[data-todo="${props.pop.id}"]`) ?? null}
      today={props.today}
      onClose={props.onClose}
      onNotice={props.onNotice}
    />
  );
}

/** The table with the panel beside it, or on a narrow pane the panel in the table's place. */
function Split(props: { narrow: boolean; panel: ReactNode | null; children: ReactNode }) {
  const { narrow, panel } = props;
  return (
    <div className="flex min-h-0 flex-1">
      {!(narrow && panel !== null) && (
        <div className="flex min-w-0 flex-1 flex-col">{props.children}</div>
      )}
      {panel !== null && (
        <div
          className={
            narrow ? "min-w-0 flex-1" : "w-[min(560px,42%)] shrink-0 border-k-rule border-l"
          }
        >
          {panel}
        </div>
      )}
    </div>
  );
}

/** The panel for what is open: a new todo, or the todo picked. */
function PanelSlot(props: {
  panel: Panel;
  shown: TodoRow | undefined;
  data: ReturnType<typeof useTodoData>;
  today: string;
  onClose: () => void;
  onNew: (preset: Preset) => void;
  onOpenTodo: (id: string) => void;
  onOpenNote: (path: string) => void;
  onNotice: (text: string) => void;
}) {
  const { panel, shown, data, today } = props;
  if (panel?.kind === "new") {
    return (
      <NewTodoPanel
        today={today}
        projects={data.projects}
        dailyNote={periodicNote("daily", new Date()).path}
        preset={panel.preset}
        onClose={props.onClose}
        onAdded={(row, next) => (next ? props.onNew(panel.preset) : props.onOpenTodo(row.id))}
        onNotice={props.onNotice}
      />
    );
  }
  if (shown === undefined) return null;
  return (
    <TodoPanel
      key={shown.id}
      row={shown}
      parts={data.rows.filter((each) => each.parent_id === shown.id && each.round_of === null)}
      projects={data.projects}
      files={data.files}
      today={today}
      running={data.running.has(shown.id)}
      onClose={props.onClose}
      onOpenTodo={props.onOpenTodo}
      onOpenNote={props.onOpenNote}
      onNotice={props.onNotice}
    />
  );
}

function TabButton(props: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={props.on}
      onClick={props.onClick}
      className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1 text-[15px] ${
        props.on ? "bg-k-inset font-semibold text-k-ink" : "text-k-ink-soft hover:text-k-ink"
      }`}
    >
      {props.children}
    </button>
  );
}

function Toolbar(props: {
  tab: Tab | "board";
  onTab: (tab: Tab | "board") => void;
  counts: (tab: Tab) => number;
  filter: RefObject<HTMLInputElement | null>;
  typed: string;
  onTyped: (typed: string) => void;
  onDone: () => void;
  by: GroupBy;
  onBy: (by: GroupBy) => void;
  onNew: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-k-rule border-b px-4 py-2.5">
      {TABS.map(({ tab, label }) => (
        <TabButton key={tab} on={props.tab === tab} onClick={() => props.onTab(tab)}>
          {label}
          {(tab === "today" || tab === "inbox") && (
            <span className="font-normal text-k-muted">{props.counts(tab) || ""}</span>
          )}
        </TabButton>
      ))}
      <TabButton on={props.tab === "board"} onClick={() => props.onTab("board")}>
        <Icon name="board" />
        Board
      </TabButton>
      {props.tab !== "board" && (
        <>
          <span className="mx-2 h-5 w-px shrink-0 bg-k-rule" />
          <label className="flex min-w-24 flex-1 items-center gap-2 text-k-muted">
            <Icon name="filter" />
            <input
              ref={props.filter}
              aria-label="Filter todos"
              value={props.typed}
              placeholder="filter"
              onChange={(event) => props.onTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === "Escape") props.onDone();
              }}
              className="w-full min-w-0 bg-transparent font-mono text-k-ink text-sm outline-none placeholder:text-k-muted"
            />
          </label>
          <select
            aria-label="Group by"
            value={props.by}
            onChange={(event) => props.onBy(event.target.value as GroupBy)}
            className="shrink-0 rounded-md border border-k-rule bg-k-paper px-2 py-1 text-k-ink text-sm"
          >
            {props.tab === "upcoming" && <option value="day">Group: day</option>}
            <option value="state">Group: state</option>
            <option value="project">Group: project</option>
          </select>
          <button
            type="button"
            onClick={props.onNew}
            className="sticky right-0 flex shrink-0 items-center gap-1.5 rounded-md bg-k-accent px-3 py-1 font-medium text-[15px] text-k-bg shadow-[-12px_0_12px_var(--k-bg)]"
          >
            <Icon name="plus" />
            New
            <kbd className="rounded border border-current/40 px-1 font-mono text-xs">a</kbd>
          </button>
        </>
      )}
    </div>
  );
}

const HINTS = [
  ["j k", "move"],
  ["Enter", "edit in the panel"],
  ["x", "done"],
  ["d", "date"],
  ["s", "state"],
  ["p", "priority"],
  ["g n", "go to its note"],
  ["a", "add"],
  ["/", "filter"],
];

function KeyHints() {
  return (
    <p className="hidden shrink-0 flex-wrap gap-x-4 border-k-rule border-t px-4 py-2 text-k-muted text-sm [@media(pointer:fine)]:flex">
      {HINTS.map(([key, does]) => (
        <span key={key} className="whitespace-nowrap">
          <b className="text-k-ink-soft">{key}</b> {does}
        </span>
      ))}
    </p>
  );
}
