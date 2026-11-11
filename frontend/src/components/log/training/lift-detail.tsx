/** One lift in depth: its e1RM over the weeks with deloads shaded, its records and its last days. */

import { TrendLine } from "@/components/charts";
import { monthDay } from "@/components/log/log-weight";
import { grouped } from "@/lib/log/log-words";
import type { TrainingDay } from "@/lib/log/training/exercises";
import {
  bestsOf,
  deloadWeeks,
  lastSessions,
  liftWeeks,
  volumeWeeks,
} from "@/lib/log/training/progress";
import { dayLabel } from "@/lib/log/training/session-lines";

const LAST = 5;

interface LiftDetailProps {
  lift: string;
  days: TrainingDay[];
  starts: string[];
  onBack: () => void;
}

export function LiftDetail({ lift, days, starts, onBack }: LiftDetailProps) {
  const weeks = liftWeeks(days, lift, starts);
  const deloads = deloadWeeks(volumeWeeks(days, starts, lift));
  const bests = bestsOf(days, lift);
  const sessions = lastSessions(days, lift, LAST);
  const shaded = deloads.filter(Boolean).length;

  return (
    <section aria-label={lift} className="training-detail">
      <div className="log-pane-row">
        <button type="button" className="log-pane-button" onClick={onBack}>
          All tiles
        </button>
        <h2>{lift}</h2>
      </div>
      <figure className="log-chart">
        <h3 className="log-chart-title">Estimated 1RM</h3>
        <TrendLine
          values={weeks}
          shaded={deloads}
          label={`${lift}: best estimated 1RM per week over ${starts.length} weeks`}
        />
        <figcaption>
          {`best e1RM per week over ${grouped(starts.length)} weeks`}
          {shaded === 0
            ? ""
            : `, ${grouped(shaded)} deload ${shaded === 1 ? "week" : "weeks"} shaded`}
        </figcaption>
      </figure>
      <dl className="log-summary">
        <div className="log-summary-tile">
          <dt>Heaviest set</dt>
          <dd className="log-summary-figure">
            {bests.heaviest === null ? "—" : `${grouped(bests.heaviest)} kg`}
          </dd>
        </div>
        <div className="log-summary-tile">
          <dt>Most reps</dt>
          <dd className="log-summary-figure">
            {bests.reps === null
              ? "—"
              : `${grouped(bests.reps.reps)} × ${grouped(bests.reps.kg)} kg`}
          </dd>
        </div>
        <div className="log-summary-tile">
          <dt>Most volume</dt>
          <dd className="log-summary-figure">
            {bests.volume === null ? "—" : `${grouped(Math.round(bests.volume))} kg`}
          </dd>
        </div>
      </dl>
      <h3 className="log-chart-title">Last sessions</h3>
      {sessions.length === 0 ? (
        <p className="log-summary-words">No sessions in this range.</p>
      ) : (
        <ul className="training-sessions">
          {sessions.map((session) => (
            <li key={session.date}>
              <span>{monthDay(session.date)}</span>
              <span>{dayLabel(session.entries)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
