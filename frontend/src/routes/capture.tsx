import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { captureDump, fetchFiles } from "@/lib/api";
import { importPage } from "@/lib/clip";
import { readClock } from "@/lib/clock";
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
 */
function Capture() {
  const shared = Route.useSearch();
  const navigate = useNavigate();
  const [draft, setDraft] = useState(() => sharedDraft(shared));
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent[]>([]);
  const field = useRef<HTMLTextAreaElement>(null);
  const counter = useRef(0);

  // Read at every render rather than once, so a page left open overnight shows
  // and writes the day it is by now.
  const today = readClock(new Date());
  const typed = draft.trim();
  const address = firstAddress(typed);

  // `autoFocus` alone is not enough on Android, where a page opened from the
  // share sheet mounts before the window has the focus to give.
  useEffect(() => {
    field.current?.focus();
  }, []);

  /** Run one send, and on success list it, empty the draft and drop the share. */
  function send(write: () => Promise<string>) {
    if (sending || typed === "") return;
    setSending(true);
    setFailed(null);
    write().then(
      (what) => {
        counter.current += 1;
        const row = { key: counter.current, what, at: readClock(new Date()).time };
        setSent((previous) => [row, ...previous].slice(0, KEPT));
        setDraft("");
        setSending(false);
        // The share is spent, so a reload must not put it back in the box.
        void navigate({ to: "/capture", search: {}, replace: true });
        field.current?.focus();
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
    <main className="min-h-dvh bg-one-bg font-mono text-one-fg">
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
            onClick={() =>
              send(() => captureDump(typed, readClock(new Date()).date).then(() => typed))
            }
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

        {failed !== null && (
          <p role="alert" className="text-[13px] text-one-warn">
            {failed}
          </p>
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
