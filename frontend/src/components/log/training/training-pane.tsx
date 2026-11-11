import { useQuery } from "@tanstack/react-query";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { LiftDetail } from "@/components/log/training/lift-detail";
import {
  CardioTile,
  FigureTiles,
  LiftTile,
  WeightTile,
} from "@/components/log/training/training-tiles";
import { fetchNote, NoteMissing } from "@/lib/core/api";
import { shiftDay } from "@/lib/core/clock";
import { LOG_NOTE } from "@/lib/core/layout";
import { fetchLog } from "@/lib/log/food-api";
import { DEFAULT_CONFIG, parseConfig } from "@/lib/log/log-kinds";
import { fetchTraining } from "@/lib/log/training/exercises";
import {
  cardioWeeks,
  mainLifts,
  mondayOf,
  recordsOf,
  sessionsIn,
  weekStarts,
} from "@/lib/log/training/progress";
import type { EditorCommands } from "@/lib/ui/keys/key-bindings";
import { useLeader } from "@/lib/ui/keys/use-leader";

const SPANS = [
  { weeks: 12, name: "12 weeks" },
  { weeks: 52, name: "Year" },
] as const;
type Span = (typeof SPANS)[number]["weeks"];

export interface TrainingPaneProps {
  commands: EditorCommands;
  /** Raised by the route when this pane has been moved to. See `LogPane`. */
  focusSignal: number;
  /** Today, as `YYYY-MM-DD`. The route reads the clock; this stays pure of it. */
  today: string;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "The training did not load";
}

/**
 * The progress the training lines show, on one page of tiles: e1RM per main lift, cardio per week,
 * body weight, sessions, 5 km pace and this week's records. A lift tile opens the lift in depth.
 */
export function TrainingPane({ commands, focusSignal, today }: TrainingPaneProps) {
  const [span, setSpan] = useState<Span>(12);
  const [lift, setLift] = useState<string | null>(null);
  const panel = useRef<HTMLElement>(null);
  const leader = useLeader(commands);
  const yearAgo = shiftDay(today, -364);
  // Under `log`, so every write that refreshes the log refreshes this too.
  const training = useQuery({
    queryKey: ["log", "training", yearAgo, today],
    queryFn: () => fetchTraining(yearAgo, today),
  });
  const config = useQuery({
    queryKey: ["note", LOG_NOTE],
    queryFn: () => fetchNote(LOG_NOTE),
    select: parseConfig,
  });
  const range = span * 7;
  const from = shiftDay(today, -(range - 1));
  const log = useQuery({ queryKey: ["log", from, today], queryFn: () => fetchLog(from, today) });

  useEffect(() => {
    if (focusSignal) panel.current?.focus();
  }, [focusSignal]);

  const starts = weekStarts(today, span);
  const first = starts[0] ?? mondayOf(today);
  const all = training.data ?? [];
  const days = all.filter((day) => day.date >= first);
  const kinds =
    config.error instanceof NoteMissing ? DEFAULT_CONFIG.kinds : (config.data?.kinds ?? []);
  const weightKind = kinds.find((kind) => kind.last === true);
  const thisWeek = mondayOf(today);
  const records = recordsOf(all).filter((record) => record.date >= thisWeek);

  // The panel takes the focus before the tile or the back button it came from unmounts.
  const show = (chosen: string | null) => {
    panel.current?.focus();
    setLift(chosen);
  };
  const back = () => (lift === null ? void commands.closeNote() : show(null));
  const keys: Record<string, ((event: KeyboardEvent) => void) | undefined> = {
    " ": (event) => leader.start(event),
    w: () => setSpan((was) => (was === 12 ? 52 : 12)),
    q: () => void commands.closeNote(),
    Escape: back,
  };

  function onKeyDown(event: KeyboardEvent) {
    if (leader.feed(event)) return;
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    // Space on a focused tile is that button's own press.
    if (event.key === " " && event.target instanceof HTMLButtonElement) return;
    const act = keys[event.key];
    if (act === undefined) return;
    act(event);
    event.preventDefault();
  }

  return (
    <section
      ref={panel}
      tabIndex={-1}
      aria-label="Training"
      onKeyDown={onKeyDown}
      className="log-pane-frame"
    >
      <header className="log-pane-head">
        <h2 className="training-title">Training</h2>
        <div role="tablist" aria-label="Span" className="log-pane-tabs">
          {SPANS.map((choice) => (
            <button
              key={choice.weeks}
              type="button"
              role="tab"
              aria-selected={span === choice.weeks}
              className="log-pane-tab"
              onClick={() => setSpan(choice.weeks)}
            >
              {choice.name}
            </button>
          ))}
        </div>
      </header>
      <div className="log-pane">
        {training.error && training.data === undefined ? (
          <p role="alert">{messageOf(training.error)}</p>
        ) : null}
        {lift === null ? (
          <div className="log-trends">
            <div className="training-tiles">
              {mainLifts(days).map((name) => (
                <LiftTile key={name} lift={name} days={days} starts={starts} onOpen={show} />
              ))}
              <CardioTile weeks={cardioWeeks(days, starts)} />
              <WeightTile kind={weightKind} from={from} range={range} days={log.data ?? []} />
              <FigureTiles
                sessions={sessionsIn(days, first, today)}
                weeks={span}
                days={days}
                records={records}
              />
            </div>
            {training.data !== undefined && days.length === 0 ? (
              <p className="log-summary-words">
                No training lines in this span. Log a session from today's note.
              </p>
            ) : null}
          </div>
        ) : (
          <LiftDetail lift={lift} days={days} starts={starts} onBack={() => show(null)} />
        )}
      </div>
    </section>
  );
}
