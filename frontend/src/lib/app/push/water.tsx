import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { durationLabel, parseDuration, startRepeat, type Timer } from "@/lib/app/push/timers";

/** The push each glass rings with; the switch hides while a timer of this label runs. */
export const WATER_LABEL = "Drink water";

export const WATER_KEY = "kasten.water";

/** The gap and stop time last used on this device, which the next morning starts from. */
export type WaterPlan = { every: number; until: string };

const DEFAULT_PLAN: WaterPlan = { every: 90 * 60, until: "21:00" };

const BUTTON =
  "rounded-[var(--k-radius-6)] border px-2 py-1 font-sans text-k-13 transition-colors duration-(--k-hover) disabled:opacity-50 pointer-coarse:min-h-11 pointer-coarse:px-3";
const FIELD =
  "min-w-0 rounded-[var(--k-radius-6)] border border-k-rule bg-k-paper px-2 py-1 font-sans text-k-15 text-k-ink pointer-coarse:min-h-11";

/** The plan kept on this device, or the default where none is kept or storage is blocked. */
export function readPlan(): WaterPlan {
  let value: string | null;
  try {
    value = localStorage.getItem(WATER_KEY);
  } catch (error) {
    if (error instanceof DOMException) return DEFAULT_PLAN;
    throw error;
  }
  if (value === null) return DEFAULT_PLAN;
  try {
    const { every, until } = JSON.parse(value) as Partial<WaterPlan>;
    if (typeof every === "number" && every >= 60 && typeof until === "string" && clock(until)) {
      return { every, until };
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  return DEFAULT_PLAN;
}

function keepPlan(plan: WaterPlan): void {
  try {
    localStorage.setItem(WATER_KEY, JSON.stringify(plan));
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
  }
}

function clock(text: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text);
}

/** Today at `until` in this device's zone, or null when that time has passed. */
export function stopTime(until: string, now: Date): Date | null {
  const [hours = 0, minutes = 0] = until.split(":").map(Number);
  const stop = new Date(now);
  stop.setHours(hours, minutes, 0, 0);
  return stop > now ? stop : null;
}

/**
 * The morning switch: one tap rings a glass of water now and every gap after it until the stop
 * time, on every subscribed device. Hidden while that repeat runs, since the timers list it.
 */
export function WaterSwitch({ running, onStarted }: { running: Timer[]; onStarted: () => void }) {
  const [plan] = useState(readPlan);
  const [gap, setGap] = useState(() => durationLabel(plan.every));
  const [until, setUntil] = useState(plan.until);
  const [failed, setFailed] = useState<string | null>(null);

  const start = useMutation({
    mutationFn: ({ every, stop }: { every: number; stop: Date }) =>
      startRepeat(WATER_LABEL, every, stop),
    onMutate: () => setFailed(null),
    onSuccess: (_, { every }) => {
      keepPlan({ every, until });
      onStarted();
    },
    onError: (error) => setFailed(error.message || "Could not start the water reminders"),
  });

  if (running.some((timer) => timer.label === WATER_LABEL)) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const every = parseDuration(gap);
    if (every === null || every < 60) {
      setFailed("Give a gap of a minute or more, such as 90 or 1h 30m");
      return;
    }
    const stop = clock(until) ? stopTime(until, new Date()) : null;
    if (stop === null) {
      setFailed("Pick a stop time later today");
      return;
    }
    start.mutate({ every, stop });
  };

  return (
    <form
      data-water
      onSubmit={submit}
      className="flex flex-wrap items-center gap-2 px-2 font-sans text-k-13"
    >
      <button
        type="submit"
        disabled={start.isPending}
        className={`${BUTTON} border-k-rule text-k-ink hover:text-k-accent`}
      >
        Remind me to drink water
      </button>
      <label className="flex items-center gap-1 text-k-muted">
        every
        <input
          aria-label="Gap between glasses"
          data-timer-field
          value={gap}
          onChange={(event) => setGap(event.target.value)}
          className={`${FIELD} w-24`}
        />
      </label>
      <label className="flex items-center gap-1 text-k-muted">
        until
        <input
          aria-label="Stop time"
          data-timer-field
          type="time"
          value={until}
          onChange={(event) => setUntil(event.target.value)}
          className={`${FIELD} w-28`}
        />
      </label>
      {failed !== null && (
        <p role="alert" className="basis-full text-k-danger">
          {failed}
        </p>
      )}
    </form>
  );
}
