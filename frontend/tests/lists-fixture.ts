import type { ListData } from "@/lists/lists-store";

/**
 * The `/share` routes, held in memory for the lists tests. It answers as the
 * contract says: a write whose sha is not the note's current one gets 409 with
 * the note's sha, and a tick naming no line changes nothing.
 */

export type Seed = { text: string; done: boolean };

type Note = { rev: number; items: Seed[] };

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function fakeShare(seed: Record<string, Seed[]>) {
  const notes = new Map<string, Note>(
    Object.entries(seed).map(([name, items]) => [
      name,
      { rev: 1, items: items.map((item) => ({ ...item })) },
    ]),
  );
  const posts: { path: string; body: Record<string, unknown> }[] = [];
  let hook: (() => void) | undefined;
  let hooks = 0;
  let lose = false;
  let signIn = false;

  function view(name: string): ListData {
    const note = notes.get(name);
    return {
      name,
      sha: note ? String(note.rev) : null,
      items: (note?.items ?? []).map((item, line) => ({ line, ...item })),
    };
  }

  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const match = /^\/share\/lists\/([^/]+)(?:\/(items|tick|clear))?$/.exec(url);
    if (!match) return reply({ detail: "No such list" }, 404);
    const name = decodeURIComponent(match[1] ?? "");
    const action = match[2];
    if (!action) return reply(view(name));

    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    posts.push({ path: url, body });
    if (signIn) {
      // An expired session: the sign-in page answers in place of the JSON.
      signIn = false;
      return new Response("<!doctype html><title>Anmelden</title>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    }
    // Another writer gets in between this write's read and its check.
    if (hooks > 0) {
      hooks -= 1;
      hook?.();
    }

    const note = notes.get(name);
    const current = note ? String(note.rev) : null;
    if (body.sha !== current) return reply({ detail: "Stale", current }, 409);

    const items = [...(note?.items ?? [])];
    if (action === "items") items.push({ text: String(body.text), done: false });
    if (action === "tick") {
      const at = Number(body.line);
      if (items[at]) items[at] = { ...items[at], done: Boolean(body.done) };
    }
    const kept = action === "clear" ? items.filter((item) => !item.done) : items;
    notes.set(name, { rev: (note?.rev ?? 0) + 1, items: kept });
    const answer = reply(view(name));
    if (lose) {
      // The write landed and the answer never came back.
      lose = false;
      throw new TypeError("Failed to fetch");
    }
    return answer;
  });

  return {
    fetch,
    /** Every write the app sent, in order. */
    posts,
    /** Run before each of the next `times` writes is checked: another writer gets in. */
    beforeWrite: (run: () => void, times = 1) => {
      hook = run;
      hooks = times;
    },
    /** The next write lands, and its answer is lost on the way back. */
    loseNextAnswer: () => {
      lose = true;
    },
    /** The next write is answered by the sign-in page. */
    signInNext: () => {
      signIn = true;
    },
    /** Another writer adds an item at the top of a list, the way kasten would. */
    external: (name: string, text: string) => {
      const note = notes.get(name) ?? { rev: 0, items: [] };
      notes.set(name, { rev: note.rev + 1, items: [{ text, done: false }, ...note.items] });
    },
    items: (name: string): Seed[] => notes.get(name)?.items ?? [],
  };
}

/** Make `navigator.onLine` answer `value`. Undo with `Reflect.deleteProperty(navigator, "onLine")`. */
export function setOnline(value: boolean): void {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => value });
}
