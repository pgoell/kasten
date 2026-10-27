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

/**
 * The agent tokens, on a page of its own.
 *
 * A standalone route on the `/review` precedent: its own URL, no pane, no
 * leader key and no entry in the editor keys. A screen visited a few times a
 * year is a URL you type, and a binding for it would be a key nobody remembers.
 *
 * It shows a secret exactly once, in local state that a refresh loses, because
 * only digests are kept and there is no way back to one. There is no rename, no
 * scope and no expiry. Usage comes from the action log in Postgres, which keeps
 * every request a token makes for 90 days: each token's last use, and its recent
 * actions behind an Actions button. The revoke is the whole point of naming them.
 */
function Tokens() {
  const [name, setName] = useState("");
  const [minted, setMinted] = useState<Minted | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const queryClient = useQueryClient();

  const { data: tokens } = useQuery({ queryKey: ["tokens"], queryFn: fetchTokens });
  // One instant for every row, so two tokens used at the same moment read the same.
  const now = new Date();

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
   * The line that connects a client to this vault, with the secret already in it.
   *
   * Built off `window.location.origin` rather than a setting, so the endpoint is
   * whatever hostname you are reading this on and nothing has to be configured
   * anywhere for it to be right.
   */
  function connectLine(secret: string): string {
    return `claude mcp add --transport http kasten ${window.location.origin}/agent/mcp --header "Authorization: Bearer ${secret}"`;
  }

  return (
    <main className="min-h-dvh bg-k-bg font-mono text-k-ink">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
        <header className="flex items-baseline gap-3">
          <h1 className="text-[15px]">agent tokens</h1>
          <span className="text-[11px] text-k-muted uppercase tracking-wider">
            {tokens?.length ?? 0} in the vault
          </span>
        </header>

        <p className="text-[13px] text-k-muted">
          A token reaches <span className="text-k-ink">/agent/</span> and nothing else: list, read,
          search, query the graph, save, append and dump. It cannot delete, move or rename anything.
          The secret is shown once, here, and is never recoverable afterwards. Every request a token
          makes is recorded with its path and status, kept 90 days.
        </p>

        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() !== "") mint.mutate(name.trim());
          }}
        >
          <label className="flex min-w-0 flex-1 items-center gap-3" htmlFor="token-name">
            <span className="text-[12px] text-k-muted">Name</span>
            <input
              id="token-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="laptop"
              className="min-h-11 min-w-0 flex-1 rounded border border-k-rule bg-transparent px-3 text-[13px] outline-none focus:border-k-accent pointer-coarse:text-base"
            />
          </label>
          <button
            type="submit"
            className="min-h-11 rounded border border-k-rule px-4 text-[12px] text-k-muted hover:border-k-accent hover:text-k-accent"
          >
            Mint
          </button>
        </form>

        {minted !== null && (
          <section className="flex flex-col gap-3 rounded border border-k-accent p-4">
            <div className="flex items-baseline gap-3">
              <span className="text-[13px]">{minted.name}</span>
              <span className="text-[11px] text-k-muted uppercase tracking-wider">shown once</span>
            </div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all text-[13px]">{minted.secret}</code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(minted.secret).then(() => {
                    setCopied(true);
                  });
                }}
                className="min-h-11 shrink-0 rounded border border-k-rule px-3 text-[12px] text-k-muted hover:border-k-accent hover:text-k-accent"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <code className="break-all text-[12px] text-k-muted">{connectLine(minted.secret)}</code>
          </section>
        )}

        <ul className="flex flex-col gap-2">
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
          <p className="text-[13px] text-k-muted">
            No tokens yet. Nothing outside this box can reach the vault until there is one.
          </p>
        )}

        {failed !== null && (
          <p role="alert" className="text-k-muted">
            {failed}
          </p>
        )}
      </div>
    </main>
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

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="min-w-0 max-w-full truncate text-[13px]">{token.name}</span>
      <span className="text-[12px] text-k-muted">
        {new Date(token.created).toISOString().slice(0, 10)}
      </span>
      <span className="text-[12px] text-k-muted">
        {last === "never" ? "never used" : `used ${last}`}
      </span>
      {unused(token, now) && (
        <span className="text-[11px] text-k-accent uppercase tracking-wider">
          unused {UNUSED_DAYS} days
        </span>
      )}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
        className="min-h-11 rounded border border-k-rule px-3 text-[12px] text-k-muted hover:border-k-accent hover:text-k-accent"
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
        className="min-h-11 rounded border border-k-rule px-3 text-[12px] text-k-muted hover:border-k-accent hover:text-k-accent"
      >
        Revoke
      </button>
      {/* Kept in the DOM while closed so the button's aria-controls always has a target. */}
      <div id={panelId} hidden={!open} className="w-full">
        {actions.data?.length === 0 && (
          <p className="text-[12px] text-k-muted">No actions in the last 90 days.</p>
        )}
        <ul className="flex flex-col gap-1 border-k-rule border-l pl-3 text-[12px]">
          {actions.data?.map((action) => (
            <li
              key={`${action.at}-${action.method}-${action.path}`}
              className="flex flex-wrap gap-x-3 gap-y-1"
            >
              <span className="text-k-muted">{lastUse(action.at, now)}</span>
              <span className="min-w-0 break-all">
                {action.tool ?? `${action.method} ${action.path}`}
              </span>
              {action.note !== null && (
                <span className="min-w-0 break-all text-k-muted">{action.note}</span>
              )}
              {action.outcome !== "ok" && (
                <span className="text-k-accent">
                  {action.status} {action.outcome}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}
