import { Icon } from "@/components/todo/view/view-icons";
import type { TodoRow } from "@/lib/core/api";
import { minutes } from "@/lib/todo/view/rows/row-facts";
import { type WeekDay, weekdayName } from "@/lib/todo/view/rows/upcoming";
import { upcomingWeek } from "@/lib/todo/view/rows/view-rows";

/** `3 · 2h30m`, the count alone with no time given, or free. */
function loadText(day: WeekDay): string {
  if (day.count === 0) return "free";
  return day.minutes === 0
    ? String(day.count)
    : `${day.count} · ${minutes(day.minutes).replace(/ /g, "")}`;
}

/** The week ahead as seven days, each with a bar for how full it is; a day jumps to its group. */
export function WeekStrip(props: {
  rows: TodoRow[];
  today: string;
  picked: string | null;
  onDay: (day: string) => void;
}) {
  return (
    <ol
      aria-label="The week ahead"
      className="grid shrink-0 grid-cols-[repeat(7,minmax(84px,1fr))] overflow-x-auto border-k-rule border-b"
    >
      {upcomingWeek(props.rows, props.today).map((day) => (
        <li key={day.day} className="min-w-0 border-k-rule border-r last:border-r-0">
          <button
            type="button"
            aria-pressed={props.picked === day.day}
            aria-label={`${weekdayName(day.day)} ${Number(day.day.slice(8, 10))}, ${loadText(day)}`}
            onClick={() => props.onDay(day.day)}
            className={`flex w-full flex-col gap-1.5 px-3 py-2.5 text-left hover:bg-k-inset/60 ${
              props.picked === day.day ? "bg-k-accent-wash" : ""
            }`}
          >
            <span className="flex items-center gap-1.5">
              <b className="text-k-ink">{Number(day.day.slice(8, 10))}</b>
              <span className="text-k-ink-soft text-sm">{weekdayName(day.day).slice(0, 3)}</span>
              {day.deadline && <Icon name="flag" className="ml-auto text-k-warn" />}
            </span>
            <span className="h-1 w-full overflow-hidden rounded-full bg-k-rule">
              <span
                className={`block h-full rounded-full ${day.deadline ? "bg-k-warn" : "bg-k-accent"}`}
                style={{ width: `${Math.round(day.load * 100)}%` }}
              />
            </span>
            <span className="truncate text-k-muted text-sm">{loadText(day)}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
