import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { createToken, fetchTokens, type Minted, revokeToken } from "@/lib/api";

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
 * scope, no expiry and no usage stats: what a token has is a name and a revoke
 * button, and the revoke is the whole point of naming them.
 */
function Tokens() {
  const [name, setName] = useState("");
  const [minted, setMinted] = useState<Minted | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const queryClient = useQueryClient();

  const { data: tokens } = useQuery({ queryKey: ["tokens"], queryFn: fetchTokens });

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
    <main className="min-h-dvh bg-one-bg font-mono text-one-fg">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
        <header className="flex items-baseline gap-3">
          <h1 className="text-[15px]">agent tokens</h1>
          <span className="text-[11px] text-one-muted uppercase tracking-wider">
            {tokens?.length ?? 0} in the vault
          </span>
        </header>

        <p className="text-[13px] text-one-muted">
          A token reaches <span className="text-one-fg">/agent/</span> and nothing else: list, read,
          search, save and append. It cannot delete, move or rename anything. The secret is shown
          once, here, and is never recoverable afterwards.
        </p>

        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() !== "") mint.mutate(name.trim());
          }}
        >
          <label className="flex min-w-0 flex-1 items-center gap-3" htmlFor="token-name">
            <span className="text-[12px] text-one-muted">Name</span>
            <input
              id="token-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="laptop"
              className="min-h-11 min-w-0 flex-1 rounded border border-one-line bg-transparent px-3 text-[13px] outline-none focus:border-one-accent"
            />
          </label>
          <button
            type="submit"
            className="min-h-11 rounded border border-one-line px-4 text-[12px] text-one-muted hover:border-one-accent hover:text-one-accent"
          >
            Mint
          </button>
        </form>

        {minted !== null && (
          <section className="flex flex-col gap-3 rounded border border-one-accent p-4">
            <div className="flex items-baseline gap-3">
              <span className="text-[13px]">{minted.name}</span>
              <span className="text-[11px] text-one-muted uppercase tracking-wider">
                shown once
              </span>
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
                className="min-h-11 shrink-0 rounded border border-one-line px-3 text-[12px] text-one-muted hover:border-one-accent hover:text-one-accent"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <code className="break-all text-[12px] text-one-muted">
              {connectLine(minted.secret)}
            </code>
          </section>
        )}

        <ul className="flex flex-col gap-2">
          {tokens?.map((token) => (
            <li key={token.name} className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate text-[13px]">{token.name}</span>
              <span className="text-[12px] text-one-muted">
                {new Date(token.created).toISOString().slice(0, 10)}
              </span>
              <button
                type="button"
                aria-label={`Revoke ${token.name}`}
                onClick={() => {
                  // A native confirm rather than a dialog of our own. The one
                  // destructive button on a page visited twice a year is not
                  // worth a component, and this one cannot be dismissed by
                  // clicking past it.
                  if (window.confirm(`Revoke ${token.name}? Any agent using it stops working.`))
                    drop.mutate(token.name);
                }}
                className="min-h-11 rounded border border-one-line px-3 text-[12px] text-one-muted hover:border-one-accent hover:text-one-accent"
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>

        {tokens?.length === 0 && (
          <p className="text-[13px] text-one-muted">
            No tokens yet. Nothing outside this box can reach the vault until there is one.
          </p>
        )}

        {failed !== null && (
          <p role="alert" className="text-one-muted">
            {failed}
          </p>
        )}
      </div>
    </main>
  );
}
