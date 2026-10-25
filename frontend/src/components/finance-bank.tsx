import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { fetchSync, requestPull, type SyncStatus } from "@/lib/finance-budget-api";

/** How often the status is read again while a "pull now" waits for the bank job. */
const POLL_MS = 5000;

/** Whether a "pull now" waits for the job, or a run is still going. */
function waitingOf(data: SyncStatus | undefined): boolean {
  return data?.requested_at != null || data?.running === true;
}

/**
 * The bank sync's status and "pull now". While a request waits or a run goes, the status is
 * read every five seconds, so the card follows the job to its end; when it ends every finance
 * read is fetched again, since the pull brought bookings in.
 */
export function usePull(onNotice: (text: string | undefined) => void) {
  const queries = useQueryClient();
  const [asking, setAsking] = useState(false);
  const status = useQuery({
    queryKey: ["finance", "sync"],
    queryFn: fetchSync,
    refetchInterval: (query) => (waitingOf(query.state.data) ? POLL_MS : false),
  });
  const waiting = waitingOf(status.data);
  const waited = useRef(false);

  useEffect(() => {
    if (waited.current && !waiting) void queries.invalidateQueries({ queryKey: ["finance"] });
    waited.current = waiting;
  }, [waiting, queries]);

  async function pull() {
    // A request that waits already asks for the next pull; a second would only say so again.
    if (asking || waiting) return;
    setAsking(true);
    try {
      await requestPull();
      onNotice("Pull asked for; approve the TAN on your phone when it comes");
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      onNotice(error.message);
    } finally {
      setAsking(false);
    }
    await queries.invalidateQueries({ queryKey: ["finance", "sync"] });
  }

  return { status, pull, asking, waiting };
}

export type Pull = ReturnType<typeof usePull>;

/** A UTC time as the reader's day and minute, `24 Oct, 17:01`. */
function when(time: string): string {
  return new Date(time).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function daysWords(days: number | null | undefined): string {
  if (days == null) return "never";
  if (days === 0) return "today";
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

function lastGood(data: SyncStatus | undefined, error: Error | null): string {
  if (error !== null) return error.message;
  if (data === undefined) return "loading";
  if (data.last_success_at == null) return "no pull has worked yet";
  return `last good pull ${when(data.last_success_at)}`;
}

/** The last bank pull: when, whether it worked, the days since one did, and "Pull now". */
export function BankCard({ pull }: { pull: Pull }) {
  const data = pull.status.data;
  const run = data?.last_run;
  const waiting = pull.waiting;
  const failed = run?.outcome === "failed";
  const stale = (data?.days_since_success ?? 0) >= 7;
  return (
    <article className="overview-card">
      <h3 className="overview-name">Bank</h3>
      <p className={stale ? "overview-figure finance-danger" : "overview-figure"}>
        {data === undefined ? "…" : daysWords(data.days_since_success)}
      </p>
      <p
        className={pull.status.error ? "overview-words finance-danger" : "overview-words"}
        role={pull.status.error ? "alert" : undefined}
      >
        {lastGood(data, pull.status.error)}
      </p>
      {run == null || run.finished_at == null ? null : (
        <p className={`overview-caption finance-status-text-${failed ? "over" : "ok"}`}>
          {failed ? `last run failed ⚠ ${run.error ?? ""}`.trim() : "last run ok ✓"}
        </p>
      )}
      <button
        type="button"
        className="finance-pane-button finance-pull"
        disabled={waiting || pull.asking}
        onClick={() => void pull.pull()}
      >
        {waiting ? (
          "Waiting for the bank job…"
        ) : (
          <>
            <kbd>P</kbd> Pull now
          </>
        )}
      </button>
    </article>
  );
}
