import { useEffect, useState } from "react";
import type { Exam, Grade } from "@/lib/exam";

/**
 * How long a timer runs when no number was typed before `t`.
 *
 * 120 minutes, which is what all four of the vault's Claude practice exams
 * tell you to give yourself, and what the live exams allow.
 */
const DEFAULT_MINUTES = 120;

/** Seconds as `m:ss`. Minutes past 59 stay minutes, so two hours reads 120:00. */
function countdown(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The lengths the touch row offers, in minutes, where a keyboard types a count before `t`. */
export const LENGTHS = [30, 60, 90, DEFAULT_MINUTES, 180];

/**
 * The sitting's countdown: a timer set or taken away, and the tick that grades
 * the sitting when it runs out.
 */
export function useExamTimer(
  exam: Exam | null,
  graded: Grade | null,
  finish: (exam: Exam) => Promise<void>,
): {
  running: boolean;
  label: string;
  out: boolean;
  toggle(count: string): void;
  start(minutes: number): void;
} {
  /** When the timer runs out, as a clock reading, or null while none is set. */
  const [deadline, setDeadline] = useState<number | null>(null);
  /** How long the timer has left, in seconds. It stops where the sitting stops. */
  const [left, setLeft] = useState(0);

  // The countdown, which runs only while a timer is set and the sitting is
  // open. Counted off an absolute deadline rather than by subtracting a second
  // per tick, so a tab the browser throttled in the background comes back with
  // the right time left rather than with the seconds it was denied.
  //
  // `finish` changes with every answer, so this resubscribes often. Harmless:
  // the deadline is the state, the interval is only what reads it.
  useEffect(() => {
    if (deadline === null || exam === null || graded !== null) return;

    const tick = () => {
      const seconds = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      setLeft(seconds);
      // Time is up, so the sitting is graded where it stands, which is what a
      // real exam does with the questions you never reached.
      if (seconds === 0) void finish(exam);
    };

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [deadline, exam, graded, finish]);

  return {
    running: deadline !== null,
    label: countdown(left),
    out: left === 0,
    toggle: (count: string) =>
      setDeadline((previous) =>
        previous === null ? Date.now() + (Number(count) || DEFAULT_MINUTES) * 60_000 : null,
      ),
    start: (minutes: number) => setDeadline(Date.now() + minutes * 60_000),
  };
}
