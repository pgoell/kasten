import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useId, useState } from "react";
import {
  createToken,
  fetchTokenActions,
  fetchTokens,
  type Minted,
  revokeToken,
  type TokenUse,
} from "@/lib/token-api";
import { lastUse, UNUSED_DAYS, unused } from "@/lib/token-use";

export const Route = createFileRoute("/tokens")({
  component: Tokens,
});

const DAY = 24 * 60 * 60 * 1000;

/** The list's columns from `md` up, shared by its header and its rows so they line up. */
const COLUMNS = "md:grid-cols-[minmax(0,1fr)_96px_136px_88px_148px]";

const ROW_BUTTON =
  "min-h-11 rounded border px-3 text-k-13 transition-colors duration-(--k-hover) hover:border-k-ink pointer-fine:min-h-8 aria-expanded:bg-k-surface";

/**
 * The agent tokens, on a page of its own: no pane and no leader key, since a screen visited a few
 * times a year needs no binding. A secret is shown once, in local state, because only digests are kept.
 * Usage comes from the action log in Postgres, which keeps each request for 90 days.
 */
function Tokens() {
  const [name, setName] = useState("");
  const [minted, setMinted] = useState<Minted | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const queryClient = useQueryClient();

  const list = useQuery({ queryKey: ["tokens"], queryFn: fetchTokens });
  const tokens = list.data;
  // One instant for every row, so two tokens used at the same moment read the same.
  const now = new Date();
  const idle = tokens?.filter((token) => unused(token, now)).length ?? 0;

  const mint = useMutation({
    mutationFn: (wanted: string) => createToken(wanted),
    onSuccess: (made) => {
      setMinted(made);
      setName("");
      setFailed(null);
      void queryClient.invalidateQueries({ queryKey: ["tokens"] });
    },
    onError: (error: unknown) => {
      setFailed(error instanceof Error ? error.message : "could not mint that token");
    },
  });

  const drop = useMutation({
    mutationFn: (named: string) => revokeToken(named),
    onSuccess: (_dropped, named) => {
      // The block above shows a secret that has just stopped working, and a
      // dead secret sitting on screen next to a copy button is worth two lines
      // to take away.
      if (minted?.name === named) setMinted(null);
      setFailed(null);
      void queryClient.invalidateQueries({ queryKey: ["tokens"] });
    },
    onError: (error: unknown) => {
      setFailed(error instanceof Error ? error.message : "could not revoke that token");
    },
  });

  /**
   * The line that connects a client to this vault, with the secret in it.
   * Built off `window.location.origin`, so the endpoint is right on whatever host this page is read from.
   */
  function connectLine(secret: string): string {
    return `claude mcp add --transport http kasten ${window.location.origin}/agent/mcp --header "Authorization: Bearer ${secret}"`;
  }

  return (
    <main className="min-h-dvh bg-k-bg font-sans text-k-ink">
      {/* 1120 = 768 list + 32 gap + 320 rail, all on one left and one right edge. */}
      <div className="mx-auto flex max-w-[1168px] flex-col gap-6 px-4 py-6 md:px-6 md:py-9">
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between md:gap-8">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="font-serif text-k-27">agent tokens</h1>
            <p className="text-k-13 text-k-muted">
              {tokens === undefined ? (
                list.isPending && "Loading"
              ) : (
                <>
                  <span className="tabular-nums">{tokens.length}</span> in the vault
                  {idle > 0 && (
                    <>
                      ,{" "}
                      <span className="text-k-warn">
                        {idle} unused for {UNUSED_DAYS} days
                      </span>
                    </>
                  )}
                </>
              )}
            </p>
          </div>

          <form
            className="flex items-end gap-2 md:w-[320px] md:shrink-0"
            onSubmit={(event) => {
              event.preventDefault();
              if (name.trim() !== "") mint.mutate(name.trim());
            }}
          >
            <label className="flex min-w-0 flex-1 flex-col gap-1" htmlFor="token-name">
              <span className="font-medium text-k-12 text-k-muted">Name</span>
              <input
                id="token-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="laptop"
                className="min-h-11 w-full min-w-0 rounded border border-k-rule bg-k-surface px-3 font-mono text-k-13 outline-none placeholder:text-k-muted focus:border-k-ink pointer-coarse:text-base pointer-fine:min-h-9"
              />
            </label>
            <button
              type="submit"
              className="min-h-11 shrink-0 rounded bg-k-ink px-4 font-medium text-k-13 text-k-bg hover:opacity-85 pointer-fine:min-h-9"
            >
              Mint
            </button>
          </form>
        </header>

        {failed !== null && (
          <p role="alert" className="text-k-13 text-k-danger">
            {failed}
          </p>
        )}

        {minted !== null && (
          <section className="flex flex-col gap-3 rounded-[var(--k-radius-8)] border border-k-accent bg-k-paper p-4 md:p-5">
            <div className="flex items-baseline gap-3">
              <span className="font-mono font-medium text-k-15">{minted.name}</span>
              <span className="text-k-13 text-k-warn">shown once</span>
            </div>
            <div className="flex items-stretch rounded border border-k-rule">
              <code className="flex min-w-0 flex-1 items-center break-all bg-k-inset px-3 py-2 font-mono text-k-13">
                {minted.secret}
              </code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(minted.secret).then(() => {
                    setCopied(true);
                  });
                }}
                className="min-h-11 shrink-0 border-k-rule border-l px-4 font-medium text-k-13 hover:bg-k-surface pointer-fine:min-h-9"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <code className="break-all font-mono text-k-12 text-k-muted">
              {connectLine(minted.secret)}
            </code>
          </section>
        )}

        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 rounded-[var(--k-radius-8)] border border-k-rule bg-k-paper px-4">
            <div
              aria-hidden="true"
              className={`hidden h-10 items-center gap-x-3 text-k-12 text-k-muted md:grid ${COLUMNS}`}
            >
              <span>Token</span>
              <span>Created</span>
              <span>Last use</span>
              <span className="flex justify-between">
                <span>{UNUSED_DAYS}+ d</span>
                <span>now</span>
              </span>
            </div>

            {list.isError && (
              <p className="flex items-center gap-3 py-4 text-k-13 text-k-muted">
                Could not load the tokens.
                <button
                  type="button"
                  onClick={() => void list.refetch()}
                  className="min-h-11 font-medium text-k-ink underline pointer-fine:min-h-8"
                >
                  Retry
                </button>
              </p>
            )}

            {list.isPending && (
              <div aria-hidden="true" className="flex flex-col">
                {[0, 1, 2].map((row) => (
                  <div key={row} className="flex h-14 items-center border-k-rule border-t">
                    <span className="h-3 w-1/3 rounded-sm bg-k-surface" />
                  </div>
                ))}
              </div>
            )}

            <ul className="flex flex-col">
              {tokens?.map((token) => (
                <TokenRow
                  key={token.name}
                  token={token}
                  now={now}
                  onRevoke={(named) => drop.mutate(named)}
                />
              ))}
            </ul>

            {tokens?.length === 0 && (
              <p className="py-4 text-k-13 text-k-muted">
                No tokens yet. Nothing outside this box can reach the vault until there is one.
              </p>
            )}
          </div>

          <aside className="flex flex-col gap-3 text-k-13">
            <h2 className="font-serif text-k-19">What a token can do</h2>
            <dl className="flex flex-col gap-3">
              <div>
                <dt className="text-k-12 text-k-muted">Reaches</dt>
                <dd>
                  <code className="font-mono text-k-13">/agent/</code> and nothing else
                </dd>
              </div>
              <div>
                <dt className="text-k-12 text-k-muted">Can</dt>
                <dd>List, read, search, query the graph, save, append and dump</dd>
              </div>
              <div>
                <dt className="text-k-12 text-k-muted">Cannot</dt>
                <dd>Delete, move or rename anything</dd>
              </div>
              <div>
                <dt className="text-k-12 text-k-muted">Secret</dt>
                <dd>Shown once, here, and never recoverable afterwards</dd>
              </div>
              <div>
                <dt className="text-k-12 text-k-muted">Record</dt>
                <dd>Every request a token makes, with its path and status, kept 90 days</dd>
              </div>
            </dl>
          </aside>
        </div>
      </div>
    </main>
  );
}

/**
 * How long a token has been silent, on one scale for every row: now at the right end, `UNUSED_DAYS`
 * or more at the left. A never-used token is a hollow mark at its creation date, the date
 * `unused` judges it by. The words beside it say the same, so screen readers skip it.
 */
function Silence({ token, now, idle }: { token: TokenUse; now: Date; idle: boolean }) {
  const since = new Date(token.last_used ?? token.created).getTime();
  const share = Math.min(Math.max(now.getTime() - since, 0) / (UNUSED_DAYS * DAY), 1);
  return (
    <span aria-hidden="true" className="relative mx-1 hidden h-px bg-k-rule md:block">
      <span
        style={{ left: `${(1 - share) * 100}%` }}
        className={`absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${
          idle ? "border-k-warn" : "border-k-accent"
        } ${token.last_used == null ? "bg-k-paper" : idle ? "bg-k-warn" : "bg-k-accent"}`}
      />
    </span>
  );
}

/**
 * One token: its name, when it was made, its last use and its recent actions.
 *
 * The actions are fetched only once the button opens them, so a page of many
 * tokens costs one request, not one per row, until someone asks for a list.
 */
function TokenRow({
  token,
  now,
  onRevoke,
}: {
  token: TokenUse;
  now: Date;
  onRevoke: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const actions = useQuery({
    queryKey: ["tokens", token.name, "actions"],
    queryFn: () => fetchTokenActions(token.name),
    enabled: open,
  });

  const last = lastUse(token.last_used ?? null, now);
  const idle = unused(token, now);

  return (
    <li className="border-k-rule border-t first:border-t-0 md:first:border-t">
      <div
        className={`grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-3 md:py-2 ${COLUMNS}`}
      >
        <div className="flex min-w-0 flex-col gap-0.5 md:contents">
          <span className="min-w-0 truncate font-medium font-mono text-k-13">{token.name}</span>
          <span className="text-k-13 text-k-muted tabular-nums">
            <span className="md:sr-only">created </span>
            {new Date(token.created).toISOString().slice(0, 10)}
          </span>
          <span className="flex flex-col text-k-13">
            <span>{last === "never" ? "never used" : `used ${last}`}</span>
            {idle && <span className="text-k-12 text-k-warn">unused {UNUSED_DAYS} days</span>}
          </span>
          <Silence token={token} now={now} idle={idle} />
        </div>
        <div className="flex justify-end gap-1">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen(!open)}
            className={`${ROW_BUTTON} border-transparent`}
          >
            Actions
          </button>
          <button
            type="button"
            aria-label={`Revoke ${token.name}`}
            onClick={() => {
              // A native confirm rather than a dialog of our own. The one
              // destructive button on a page visited twice a year is not
              // worth a component, and this one cannot be dismissed by
              // clicking past it.
              if (window.confirm(`Revoke ${token.name}? Any agent using it stops working.`))
                onRevoke(token.name);
            }}
            className={`${ROW_BUTTON} ${idle ? "border-k-danger text-k-danger" : "border-transparent"}`}
          >
            Revoke
          </button>
        </div>
      </div>
      {/* Kept in the DOM while closed so the button's aria-controls always has a target. */}
      <div id={panelId} hidden={!open} className="mb-3 rounded bg-k-inset px-3 py-2">
        {actions.isPending && open && <p className="text-k-13 text-k-muted">Reading the log</p>}
        {actions.isError && <p className="text-k-13 text-k-muted">Could not load these actions.</p>}
        {actions.data?.length === 0 && (
          <p className="text-k-13 text-k-muted">No actions in the last 90 days.</p>
        )}
        <ul className="flex flex-col gap-1 text-k-13">
          {actions.data?.map((action) => (
            <li
              key={`${action.at}-${action.method}-${action.path}`}
              className="grid gap-x-3 md:grid-cols-[88px_minmax(0,1fr)]"
            >
              <span className="text-k-muted tabular-nums">{lastUse(action.at, now)}</span>
              <span className="flex min-w-0 flex-wrap gap-x-3">
                <span className="min-w-0 break-all font-mono text-k-12">
                  {action.tool ?? `${action.method} ${action.path}`}
                </span>
                {action.note !== null && (
                  <span className="min-w-0 break-all font-mono text-k-12 text-k-muted">
                    {action.note}
                  </span>
                )}
                {action.outcome !== "ok" && (
                  <span className="text-k-danger">
                    {action.status} {action.outcome}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}
