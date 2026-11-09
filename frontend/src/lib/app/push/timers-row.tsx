import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import {
  durationLabel,
  fetchTimers,
  keepRecent,
  parseDuration,
  type Recent,
  readRecent,
  remaining,
  startTimer,
  stopTimer,
  type Timer,
} from "@/lib/app/push/timers";
import { WaterSwitch } from "@/lib/app/push/water";

const SMALL_BUTTON =
  "rounded-[var(--k-radius-6)] border px-2 py-1 font-sans text-k-13 transition-colors duration-(--k-hover) disabled:opacity-50 pointer-coarse:min-h-11 pointer-coarse:px-3";
const FIELD =
  "min-w-0 rounded-[var(--k-radius-6)] border border-k-rule bg-k-paper px-2 py-1 font-sans text-k-15 text-k-ink placeholder:text-k-muted pointer-coarse:min-h-11";

/** Every second while a timer runs, so its clock counts down; still when none does. */
function useNow(running: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [running]);
  return now;
}

/**
 * The Today page's timers: each one counting down with its Stop, a form that
 * starts one, and the last few started here, a tap each. The server pushes a
 * timer to every subscribed device when it rings, open page or not.
 */
export function TimersRow() {
  const queryClient = useQueryClient();
  const timers = useQuery({
    queryKey: ["timers"],
    queryFn: fetchTimers,
    // The sender removes a rung timer within a tick, so a rung one is read again soon.
    refetchInterval: (query) =>
      (query.state.data ?? []).some((timer) => new Date(timer.due) <= new Date()) ? 5000 : 60000,
  });
  const running = timers.data ?? [];
  const now = useNow(running.length > 0);
  const [recent, setRecent] = useState<Recent[]>(readRecent);
  const [label, setLabel] = useState("");
  const [duration, setDuration] = useState("");
  const [failed, setFailed] = useState<string | null>(null);

  const changed = () => void queryClient.invalidateQueries({ queryKey: ["timers"] });

  const start = useMutation({
    mutationFn: (timer: Recent) => startTimer(timer.label, timer.seconds),
    onMutate: () => setFailed(null),
    onSuccess: (_, timer) => {
      setRecent(keepRecent(timer));
      setLabel("");
      setDuration("");
      changed();
    },
    onError: (error) => setFailed(error.message || "Could not start the timer"),
  });

  const stop = useMutation({
    mutationFn: (timer: Timer) => stopTimer(timer.id),
    onMutate: () => setFailed(null),
    onSuccess: changed,
    onError: (error) => setFailed(error.message || "Could not stop the timer"),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const seconds = parseDuration(duration);
    if (seconds === null) {
      setFailed("Give a time such as 90, 1:25 or 1h 25m");
      return;
    }
    start.mutate({ label: label.trim() || "Timer", seconds });
  };

  return (
    <section data-today-timers aria-label="Timers" className="mt-8 flex flex-col gap-2">
      <h2 className="font-sans text-k-13 text-k-muted tracking-k-label">Timers</h2>

      {timers.isError && (
        <p className="px-2 font-sans text-k-13 text-k-muted">Could not load the timers.</p>
      )}

      {running.length > 0 && (
        <ul className="flex flex-col">
          {running.map((timer) => (
            <TimerLine
              key={timer.id}
              timer={timer}
              now={now}
              pending={stop.isPending}
              onStop={() => stop.mutate(timer)}
            />
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="flex flex-wrap items-center gap-2 px-2">
        <input
          aria-label="Timer name"
          placeholder="Washer"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          className={`${FIELD} w-40 flex-1`}
        />
        <input
          aria-label="Duration"
          placeholder="1h 25m"
          inputMode="text"
          value={duration}
          onChange={(event) => setDuration(event.target.value)}
          className={`${FIELD} w-28`}
        />
        <button
          type="submit"
          disabled={start.isPending}
          className={`${SMALL_BUTTON} border-k-ink bg-k-ink text-k-bg hover:opacity-85`}
        >
          Start
        </button>
      </form>

      <WaterSwitch running={running} onStarted={changed} />

      {recent.length > 0 && (
        <div className="flex flex-wrap gap-2 px-2">
          {recent.map((timer) => (
            <button
              key={`${timer.label}:${timer.seconds}`}
              type="button"
              disabled={start.isPending}
              onClick={() => start.mutate(timer)}
              className={`${SMALL_BUTTON} border-k-rule text-k-ink hover:text-k-accent`}
            >
              {`${timer.label} · ${durationLabel(timer.seconds)}`}
            </button>
          ))}
        </div>
      )}

      {failed !== null && (
        <p role="alert" className="px-2 font-sans text-k-13 text-k-danger">
          {failed}
        </p>
      )}
    </section>
  );
}

/** One timer: its label, the time left or Done, the clock time it rings, and Stop. */
function TimerLine({
  timer,
  now,
  pending,
  onStop,
}: {
  timer: Timer;
  now: Date;
  pending: boolean;
  onStop: () => void;
}) {
  const due = new Date(timer.due);
  const rung = due <= now;
  const at = due.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return (
    <li
      data-timer
      className="flex flex-wrap items-baseline justify-between gap-x-3 px-2 py-1 font-sans text-k-15 text-k-ink"
    >
      <span className="min-w-28 flex-1 truncate">{timer.label}</span>
      <span className="ml-auto shrink-0 text-k-13 text-k-muted tabular-nums">
        {timer.every ? `every ${durationLabel(timer.every)} · next ${at}` : `ends ${at}`}
      </span>
      <span className={`shrink-0 tabular-nums ${rung ? "text-k-accent" : ""}`}>
        {rung && !timer.every ? "Done" : remaining(timer.due, now)}
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={onStop}
        className={`${SMALL_BUTTON} shrink-0 border-transparent text-k-muted hover:text-k-accent`}
      >
        Stop
      </button>
    </li>
  );
}
