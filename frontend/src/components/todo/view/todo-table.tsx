import { TodoStateBox } from "@/components/todo/todo-state-box";
import { Icon, type IconName, PriorityBars } from "@/components/todo/view/view-icons";
import type { TodoRow } from "@/lib/core/api";
import {
  type DateCell,
  dateCell,
  detailCell,
  minutes,
  projectHue,
} from "@/lib/todo/view/rows/row-facts";
import { type Group, type Line, projectName } from "@/lib/todo/view/rows/view-rows";

const DETAIL_ICON: Record<string, IconName> = {
  time: "clock",
  repeat: "repeat",
  wait: "hour",
  blocked: "block",
};

interface TableProps {
  groups: Group[];
  /** What an empty table says. */
  empty: string;
  byId: Map<string, TodoRow>;
  today: string;
  cursor: string | null;
  open: string | null;
  onOpen: (id: string) => void;
  onTick: (row: TodoRow) => void;
  onNew: (group: Group) => void;
}

/** The todos as a dense table, a heading per group; a row opens in the side panel. */
export function TodoTable({
  groups,
  empty,
  byId,
  today,
  cursor,
  open,
  onOpen,
  onTick,
  onNew,
}: TableProps) {
  if (groups.length === 0) return <p className="flex-1 p-6 text-k-muted">{empty}</p>;
  return (
    <div className="todo-table @container min-h-0 flex-1 overflow-y-auto">
      {groups.map((group) => (
        <section key={group.key} aria-label={group.label} data-group={group.key}>
          <GroupHeading group={group} onNew={onNew} />
          <ul>
            {group.lines.map((line) => (
              <TableRow
                key={line.row.id}
                line={line}
                byId={byId}
                today={today}
                cursor={cursor === line.row.id}
                open={open === line.row.id}
                onOpen={onOpen}
                onTick={onTick}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** A state's box or a project's dot; a day group has neither. */
function GroupMark({ group }: { group: Group }) {
  if (group.state !== undefined) return <TodoStateBox state={group.state} />;
  if (group.sub !== undefined) return null;
  return (
    <span
      className="size-2 rounded-full"
      style={{ background: projectHue(group.project ?? null) }}
    />
  );
}

/** A day group's hard due dates and the time planned on it. */
function DayLoad({ group }: { group: Group }) {
  return (
    <span className="ml-auto flex items-center gap-4 whitespace-nowrap font-normal text-k-ink-soft text-sm">
      {(group.deadlines ?? 0) > 0 && (
        <span className="flex items-center gap-1 text-k-warn">
          <Icon name="flag" />
          {group.deadlines === 1 ? "1 deadline" : `${group.deadlines} deadlines`}
        </span>
      )}
      {(group.minutes ?? 0) > 0 && <span>{minutes(group.minutes ?? 0)} planned</span>}
    </span>
  );
}

function GroupHeading({ group, onNew }: { group: Group; onNew: (group: Group) => void }) {
  return (
    <h3 className="flex h-10 items-center gap-2.5 border-k-rule border-b bg-k-surface px-4">
      <GroupMark group={group} />
      <span className="font-semibold text-k-ink text-sm">{group.label}</span>
      {group.sub && (
        <span className="whitespace-nowrap font-normal text-k-ink-soft text-sm @max-[720px]:hidden">
          {group.sub}
        </span>
      )}
      <span className="font-normal text-k-muted text-sm">{group.lines.length}</span>
      {group.sub !== undefined ? <DayLoad group={group} /> : <span className="ml-auto" />}
      {group.key !== "done" && (
        <button
          type="button"
          aria-label={`New todo in ${group.label}`}
          onClick={() => onNew(group)}
          className="rounded p-1 text-k-muted hover:bg-k-inset hover:text-k-ink"
        >
          <Icon name="plus" />
        </button>
      )}
    </h3>
  );
}

interface RowProps {
  line: Line;
  byId: Map<string, TodoRow>;
  today: string;
  cursor: boolean;
  open: boolean;
  onOpen: (id: string) => void;
  onTick: (row: TodoRow) => void;
}

/** The words with the tags taken out: tags get a column look of their own. */
const bareWords = (words: string) => words.replace(/(^|\s)#[^\s#]+/g, "").trim();

function rowTone(open: boolean, cursor: boolean): string {
  const ground = open ? "bg-k-accent-wash" : cursor ? "bg-k-inset" : "hover:bg-k-inset/60";
  return open || cursor ? `${ground} shadow-[inset_3px_0_0_var(--k-accent)]` : ground;
}

function TableRow({ line, byId, today, cursor, open, onOpen, onTick }: RowProps) {
  const { row } = line;
  const done = row.state === "done" || row.state === "rejected";
  return (
    <li
      data-todo={row.id}
      data-cursor={cursor || undefined}
      aria-current={open || undefined}
      className={`todo-row grid min-h-[52px] grid-cols-[16px_auto_minmax(0,1fr)] items-center gap-x-3 border-k-rule border-b px-4 text-[15px] ${rowTone(open, cursor)}`}
    >
      <PriorityBars priority={row.priority} />
      <button
        type="button"
        aria-label={done ? `Open ${row.words} again` : `Done: ${row.words}`}
        onClick={() => onTick(row)}
        style={{ marginLeft: line.depth * 32 }}
        className="rounded-full p-0.5 hover:bg-k-rule"
      >
        <TodoStateBox state={row.state} />
      </button>
      <button
        type="button"
        tabIndex={-1}
        onClick={() => onOpen(row.id)}
        className="grid min-w-0 cursor-default grid-cols-[minmax(0,1fr)_56px_150px_110px_36px_76px] items-center gap-x-3 py-2 text-left @max-[720px]:grid-cols-[minmax(0,1fr)_auto] @max-[720px]:gap-y-0.5"
      >
        <span className="flex min-w-0 items-center gap-2.5 @max-[720px]:col-span-2">
          <span className={`truncate ${done ? "text-k-muted line-through" : "text-k-ink"}`}>
            {bareWords(row.words)}
          </span>
          {row.tags.map((tag) => (
            <span key={tag} className="shrink-0 text-k-muted text-sm @max-[720px]:hidden">
              {tag}
            </span>
          ))}
        </span>
        <Cells line={line} byId={byId} today={today} />
      </button>
    </li>
  );
}

/** The columns after the words; on a narrow pane they wrap onto a second line. */
function Cells({ line, byId, today }: { line: Line; byId: Map<string, TodoRow>; today: string }) {
  const { row, parts } = line;
  const detail = detailCell(row, byId, today);
  const cell = "flex min-w-0 items-center gap-1.5 text-k-ink-soft text-sm";
  return (
    <>
      <span className={`${cell} @max-[720px]:hidden`}>
        {parts !== null && (
          <>
            <Icon name="parts" className="text-k-muted" />
            {parts.closed}/{parts.total}
          </>
        )}
      </span>
      <span className={`${cell} @max-[720px]:hidden`}>
        {detail !== null && (
          <>
            <Icon name={DETAIL_ICON[detail.kind] ?? "clock"} className="text-k-muted" />
            <span className="truncate">{detail.text}</span>
          </>
        )}
      </span>
      <span className={cell}>
        {row.project !== null && (
          <>
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: projectHue(row.project) }}
            />
            <span className="truncate">{projectName(row.project)}</span>
          </>
        )}
      </span>
      <span className={`${cell} @max-[720px]:hidden`}>
        {line.notes > 0 && (
          <>
            <Icon name="doc" className="text-k-muted" />
            {line.notes}
          </>
        )}
      </span>
      <DateText date={dateCell(row, today)} />
    </>
  );
}

function DateText({ date }: { date: DateCell | null }) {
  const tone = date?.late ? "text-k-danger" : date?.due ? "text-k-warn" : "text-k-ink-soft";
  return (
    <span className={`flex items-center justify-end gap-1 font-mono text-sm ${tone}`}>
      {date?.due && date.text !== "today" && <Icon name="flag" />}
      {date?.text}
    </span>
  );
}
