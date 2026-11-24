import { useEffect, useRef, useState } from "react";
import { Popover } from "@/components/todo/view/pick/popover";
import { Icon, type IconName } from "@/components/todo/view/view-icons";
import { shiftDay } from "@/lib/core/clock";
import { dayWord } from "@/lib/todo/view/rows/quick-words";
import { dayMonth, longDay } from "@/lib/todo/view/rows/row-facts";
import { weekdayName } from "@/lib/todo/view/rows/upcoming";

export type Which = "planned" | "due" | "hold_until";

export interface Dates {
  planned: string | null;
  due: string | null;
  due_hard: boolean;
  hold_until: string | null;
  repeat: string | null;
}

export type DateChange = Partial<Pick<Dates, "planned" | "due" | "due_hard" | "hold_until">>;

/** The three dates, in tab order, with how a panel row shows each. */
export const DATES: { which: Which; label: string; icon: IconName; empty: string }[] = [
  { which: "planned", label: "Planned", icon: "sun", empty: "Plan a day" },
  { which: "due", label: "Due", icon: "flag", empty: "Set a due date" },
  { which: "hold_until", label: "Hold until", icon: "hour", empty: "Not held" },
];

interface Option {
  label: string;
  day: string | null;
  icon: IconName;
}

const weekdayOf = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

/** The Monday after today. */
function nextMonday(today: string): string {
  return shiftDay(today, (8 - weekdayOf(today)) % 7 || 7);
}

/** The quick days, those whose name starts with what is typed, and the day the words name. */
export function optionsFor(typed: string, today: string): Option[] {
  const base: Option[] = [
    { label: "Today", day: today, icon: "sun" },
    { label: "Tomorrow", day: shiftDay(today, 1), icon: "sun" },
    { label: "Next week", day: nextMonday(today), icon: "sun" },
    { label: "No day", day: null, icon: "x" },
  ];
  const word = typed.trim().toLowerCase();
  if (word === "") return base;
  const named = dayWord(word, today);
  const starts = base.filter((option) => option.label.toLowerCase().startsWith(word));
  if (named === undefined || starts.some((option) => option.day === named)) return starts;
  return [{ label: weekdayName(named), day: named, icon: "sun" }, ...starts];
}

function nextTab(which: Which, back: boolean): Which {
  const at = DATES.findIndex((tab) => tab.which === which);
  return DATES[(at + (back ? 2 : 1)) % DATES.length]?.which ?? "planned";
}

/** Three weeks of days, from the Monday of this one. */
function calendarDays(today: string): string[] {
  const monday = shiftDay(today, -((weekdayOf(today) + 6) % 7));
  return Array.from({ length: 21 }, (_, at) => shiftDay(monday, at));
}

/** What picking a day for one of the three dates sends: a due date picked is a hard one. */
export function changeFor(which: Which, day: string | null): DateChange {
  if (which === "due") return { due: day, due_hard: day !== null };
  return which === "planned" ? { planned: day } : { hold_until: day };
}

/**
 * One popover for a todo's three dates: planned, due and hold until. A day is typed (`wed`,
 * `tomorrow`, `2026-12-01`), picked from the list or from the calendar; Tab moves between them.
 */
export function DatePick(props: {
  anchor: HTMLElement | null;
  dates: Dates;
  today: string;
  start: Which;
  onSet: (change: DateChange) => void;
  onClose: () => void;
}) {
  const { dates, today } = props;
  const [which, setWhich] = useState<Which>(props.start);
  const [typed, setTyped] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const options = optionsFor(typed, today);
  const set = (day: string | null) => {
    props.onSet(changeFor(which, day));
    props.onClose();
  };
  const onKey = (event: React.KeyboardEvent) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (event.key === "Tab") setWhich(nextTab(which, event.shiftKey));
    else if (step !== undefined)
      setAt((now) => (now + step + options.length) % Math.max(options.length, 1));
    else if (event.key === "Enter" && options[at] !== undefined) set(options[at].day);
    else return false;
    return true;
  };

  return (
    <Popover anchor={props.anchor} label="Dates" onClose={props.onClose} onKey={onKey}>
      <div className="flex flex-col gap-1">
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-k-inset p-1">
          {DATES.map((tab) => (
            <button
              key={tab.which}
              type="button"
              aria-pressed={which === tab.which}
              onClick={() => setWhich(tab.which)}
              className={`rounded-md py-1 text-[15px] ${
                which === tab.which
                  ? "bg-k-paper font-semibold text-k-ink shadow-sm"
                  : "text-k-ink-soft"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <input
          ref={input}
          aria-label="Type a day"
          value={typed}
          placeholder="Type a day: wed, tomorrow, 2026-12-01"
          onChange={(event) => {
            setTyped(event.target.value);
            setAt(0);
          }}
          className="mx-1 border-k-rule border-b bg-transparent py-1.5 text-k-ink outline-none placeholder:text-k-muted"
        />
        <ul aria-label="Days">
          {options.map((option, index) => (
            <li key={option.label}>
              <button
                type="button"
                onClick={() => set(option.day)}
                onPointerEnter={() => setAt(index)}
                className={`flex h-9 w-full items-center gap-2.5 rounded-md px-2 text-left text-[15px] text-k-ink ${
                  index === at ? "bg-k-inset" : ""
                }`}
              >
                <Icon name={option.icon} className="text-k-muted" />
                <span className="flex-1">{option.label}</span>
                {option.day !== null && (
                  <span className="font-mono text-k-muted text-sm">{dayMonth(option.day)}</span>
                )}
                {index === at && <kbd className="font-mono text-k-muted text-xs">↵</kbd>}
              </button>
            </li>
          ))}
        </ul>
        <Calendar dates={dates} which={which} today={today} onDay={set} />
        <DueLine dates={dates} today={today} onSet={props.onSet} />
      </div>
    </Popover>
  );
}

function Calendar(props: {
  dates: Dates;
  which: Which;
  today: string;
  onDay: (day: string) => void;
}) {
  const { dates, today } = props;
  const picked = props.which === "due" ? dates.due : dates[props.which];
  return (
    <div className="grid grid-cols-7 gap-y-1 border-k-rule border-t px-1 pt-2 text-center">
      {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((day) => (
        <span key={day} className="text-k-muted text-xs uppercase">
          {day}
        </span>
      ))}
      {calendarDays(today).map((day) => {
        const tone =
          day === picked
            ? "bg-k-accent font-semibold text-k-bg"
            : day === today
              ? "font-semibold text-k-accent"
              : day < today
                ? "text-k-muted"
                : "text-k-ink";
        const ring =
          dates.due_hard && day === dates.due && day !== picked ? "ring-1 ring-k-warn" : "";
        return (
          <button
            key={day}
            type="button"
            aria-label={longDay(day, today)}
            onClick={() => props.onDay(day)}
            className={`mx-auto size-9 rounded-md text-[15px] hover:bg-k-inset ${tone} ${ring}`}
          >
            {Number(day.slice(8, 10))}
          </button>
        );
      })}
    </div>
  );
}

/** Whether the due date is hard, and how the todo repeats. */
function DueLine(props: { dates: Dates; today: string; onSet: (change: DateChange) => void }) {
  const { dates } = props;
  return (
    <div className="mt-1 flex flex-col gap-1 border-k-rule border-t px-2 pt-2 text-[15px]">
      {dates.due !== null && (
        <label className="flex h-8 items-center gap-2.5 text-k-ink">
          <Icon name="flag" className="text-k-warn" />
          <span className="flex-1">Due {longDay(dates.due, props.today)}, hard</span>
          <input
            type="checkbox"
            checked={dates.due_hard}
            onChange={(event) => props.onSet({ due_hard: event.target.checked })}
            className="size-4 accent-[var(--k-accent)]"
          />
        </label>
      )}
      <span className="flex h-8 items-center gap-2.5 text-k-ink">
        <Icon name="repeat" className="text-k-muted" />
        <span className="flex-1">Repeat</span>
        <span className="font-mono text-k-muted text-sm">{dates.repeat ?? "never"}</span>
      </span>
    </div>
  );
}
