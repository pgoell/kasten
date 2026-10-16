import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { fetchFiles } from "@/lib/api";
import { importPage } from "@/lib/clip";
import { readClock } from "@/lib/clock";
import { type Dump, flush, keep, type State, start, subscribe } from "@/lib/outbox";
import { firstAddress, type Shared, sharedDraft } from "@/lib/share";

export const Route = createFileRoute("/capture")({
  component: Capture,
  // Android's share sheet opens this page with what was shared in the query,
  // as the manifest's `share_target` names it. Anything that is not a string
  // reads as nothing, which covers a hand-typed address as well.
  validateSearch: (search: Record<string, unknown>): Shared => ({
    title: typeof search.title === "string" ? search.title : undefined,
    text: typeof search.text === "string" ? search.text : undefined,
    url: typeof search.url === "string" ? search.url : undefined,
  }),
});

/** One thing this page put in the vault, for the list that says it landed. */
interface Sent {
  /** Counted up per send, so two identical thoughts are two rows. */
  key: number;
  what: string;
  /** The wall clock at the send, `HH:MM`. */
  at: string;
}

/** How many sends the list keeps. Enough to see the last one landed, no more. */
const KEPT = 5;

/**
 * Today's dump, on a page of its own, sized for a phone.
 *
 * A route rather than a pane, on the `/review` precedent: a phone has no
 * leader key, no vim and no panes, and the thought that arrives at a bus stop
 * is the one this is for. `<leader>cd` is the same capture at a desk.
 *
 * The list under the button is this page's own memory and nothing more. It is
 * not the dump read back: the dump is in the daily note, and what the list
 * answers is whether the last send landed.
 *
 * Send writes the thought to the outbox on the phone first and sends it
 * after, so a thought typed with no signal waits there, listed as waiting,
 * until the signal comes back. Nothing on this page asks the network to
 * mount, which is what lets it open offline at all.
 */
function Capture() {
  const shared = Route.useSearch();
  const navigate = useNavigate();
  const [draft, setDraft] = useState(() => sharedDraft(shared));
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent[]>([]);
  const [outbox, setOutbox] = useState<State>({ waiting: [], failure: null });
  const field = useRef<HTMLTextAreaElement>(null);
  const counter = useRef(0);
  const waited = useRef<Dump[]>([]);

  // Read at every render rather than once, so a page left open overnight shows
  // and writes the day it is by now.
  const today = readClock(new Date());
  const typed = draft.trim();
  const address = firstAddress(typed);
  // The vault's refusal of a waiting dump reads here as a failed clip would.
  // No signal says nothing: the rows saying "waiting" are the whole message.
  const alert = failed ?? (outbox.failure?.kind === "refused" ? outbox.failure.message : null);

  // `autoFocus` alone is not enough on Android, where a page opened from the
  // share sheet mounts before the window has the focus to give.
  useEffect(() => {
    field.current?.focus();
  }, []);

  /** Put a line at the top of the sent list. */
  function landed(what: string) {
    counter.current += 1;
    const row = { key: counter.current, what, at: readClock(new Date()).time };
    setSent((previous) => [row, ...previous].slice(0, KEPT));
  }

  // A dump that leaves the outbox has a 2xx behind it, whichever flush sent it,
  // so that is the moment it moves from the waiting list to the sent one.
  useEffect(() => {
    start();
    return subscribe((state) => {
      const still = new Set(state.waiting.map((dump) => dump.id));
      for (const dump of waited.current) {
        if (still.has(dump.id)) continue;
        // `landed`'s body, inline so this effect depends on nothing.
        counter.current += 1;
        const row = { key: counter.current, what: dump.text, at: readClock(new Date()).time };
        setSent((previous) => [row, ...previous].slice(0, KEPT));
      }
      waited.current = state.waiting;
      setOutbox(state);
    });
  }, []);

  /** Empty the box once what it held is safe, and drop the share it came from. */
  function cleared() {
    setDraft("");
    setSending(false);
    // The share is spent, so a reload must not put it back in the box.
    void navigate({ to: "/capture", search: {}, replace: true });
    field.current?.focus();
  }

  /**
   * Keep the thought on the phone, then send it.
   *
   * The box empties once the outbox has it, not once the vault does: from
   * there the thought is safe through no signal and a closed app, and the
   * waiting list is where it shows until it lands.
   */
  function sendDump() {
    if (sending || typed === "") return;
    setSending(true);
    setFailed(null);
    keep(typed, readClock(new Date()).date).then(
      () => {
        cleared();
        void flush();
      },
      (error: unknown) => {
        setSending(false);
        setFailed(error instanceof Error ? error.message : "This device could not keep that");
      },
    );
  }

  /** Run one send, and on success list it, empty the draft and drop the share. */
  function send(write: () => Promise<string>) {
    if (sending || typed === "") return;
    setSending(true);
    setFailed(null);
    write().then(
      (what) => {
        landed(what);
        cleared();
      },
      (error: unknown) => {
        // The draft stays, which is the point of keeping it: a send that
        // failed on a train is a send to press again at the next station.
        setSending(false);
        setFailed(error instanceof Error ? error.message : "That did not reach the vault");
      },
    );
  }

  return (
    // All four insets: nothing here writes the frame's bottom padding.
    <main className="safe-frame safe-foot min-h-dvh bg-one-bg font-mono text-one-fg">
      <div className="mx-auto flex max-w-xl flex-col gap-4 p-4">
        <header className="flex items-baseline gap-3">
          <h1 className="text-[15px]">dump</h1>
          <span className="text-[12px] text-one-muted">
            {today.date} {today.weekday}
          </span>
        </header>

        <textarea
          ref={field}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-label="What is on your mind"
          rows={6}
          // 16px, because iOS zooms the page into any field set smaller.
          className="min-h-40 w-full resize-y rounded border border-one-line bg-one-panel p-3 text-[16px] outline-none focus:border-one-accent"
        />

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={sending || typed === ""}
            onClick={sendDump}
            className="min-h-11 flex-1 rounded border border-one-accent px-4 text-[14px] text-one-accent disabled:border-one-line disabled:text-one-muted"
          >
            Send
          </button>
          {/* Offered only when there is an address to clip, which is what a
              shared page arrives as. The import is `<leader>cw`'s own. */}
          {address !== null && (
            <button
              type="button"
              disabled={sending}
              onClick={() =>
                send(async () => {
                  const { path } = await importPage(address, await fetchFiles());
                  return `clipped to ${path}`;
                })
              }
              className="min-h-11 flex-1 rounded border border-one-line px-4 text-[14px] text-one-muted disabled:text-one-line"
            >
              Clip to inbox
            </button>
          )}
        </div>

        {alert !== null && (
          <p role="alert" className="text-[13px] text-one-warn">
            {alert}
          </p>
        )}

        {outbox.failure?.kind === "sign-in" && (
          // A plain link and not the router's: oauth2-proxy has to see a whole
          // page load to send it to the login, which a client-side move is not.
          <p role="status" className="text-[13px] text-one-warn">
            Waiting:{" "}
            <a href="/" className="underline">
              sign in again
            </a>
          </p>
        )}

        {outbox.waiting.length > 0 && (
          <ul aria-label="Waiting" className="flex flex-col gap-2">
            {outbox.waiting.map((dump) => (
              <li key={dump.id} className="flex gap-3 text-[13px]">
                <span className="shrink-0 text-one-muted">{dump.date}</span>
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{dump.text}</span>
                <span className="shrink-0 text-one-muted">waiting</span>
              </li>
            ))}
          </ul>
        )}

        {sent.length > 0 && (
          <ul aria-label="Sent" className="flex flex-col gap-2">
            {sent.map((row) => (
              <li key={row.key} className="flex gap-3 text-[13px]">
                <span className="shrink-0 text-one-muted">{row.at}</span>
                <span className="min-w-0 whitespace-pre-wrap break-words">{row.what}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
