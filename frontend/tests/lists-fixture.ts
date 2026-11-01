import type { ListData } from "@/lists/lists-store";

/**
 * The `/share` routes, held in memory for the lists tests. It answers as the
 * contract says: a write whose sha is not the note's current one gets 409 with
 * the note's sha, and a tick naming no line changes nothing.
 */

/** A seeded line. The three person fields are the server's own, and default to none. */
export type Seed = {
  text: string;
  done: boolean;
  assignee?: string | null;
  ticked_by?: string | null;
  ticked_at?: string | null;
};

/** Who the fake session is, and the people an item can be given to. */
const WHO = { me: "Pascal", people: ["Pascal", "Alicia"] };

type Note = { rev: number; items: Seed[] };

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** What an expired session gets back for a share request: the sign-in page, in HTML. */
function signInPage(): Response {
  return new Response("<!doctype html><title>Anmelden</title>", {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
}

/** A redirect the browser will not follow: status 0 and type opaqueredirect, as `redirect: "manual"` gives. */
function opaqueRedirect(): Response {
  const res = new Response(null, { status: 302 });
  Object.defineProperties(res, { status: { value: 0 }, type: { value: "opaqueredirect" } });
  return res;
}

/** The text the server keeps for an added line: its words before the first field marker. */
const serverText = (text: string) =>
  (text.split("✅")[0] ?? "").split(/\s+/).filter(Boolean).join(" ");

/** The server's own check: only a name from `people` is written, or none. */
function unknownAssignee(action: string, body: Record<string, unknown>): boolean {
  return (
    action === "assign" && body.assignee !== null && !WHO.people.includes(String(body.assignee))
  );
}

/** The note's lines after `action` with `body`; a tick or an assign naming no line changes nothing. */
function written(items: Seed[], action: string, body: Record<string, unknown>): Seed[] {
  if (action === "items") return [...items, { text: serverText(String(body.text)), done: false }];
  if (action === "clear") return items.filter((item) => !item.done);
  const at = Number(body.line);
  const item = items[at];
  if (!item) return [...items];
  const next = [...items];
  if (action === "tick") next[at] = { ...item, done: Boolean(body.done) };
  if (action === "assign") {
    next[at] = {
      ...item,
      assignee: body.assignee === null ? null : `[[${String(body.assignee)}]]`,
    };
  }
  return next;
}

/** A request that never answers, until the caller's signal gives up on it. */
function never(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise<Response>((_, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason));
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
  let loseThenDown = false;
  let expired: "html" | "opaque" | null = null;
  let hang = false;
  let down = false;
  let refused = 0;

  function view(name: string): ListData {
    const note = notes.get(name);
    return {
      name,
      sha: note ? String(note.rev) : null,
      items: (note?.items ?? []).map((item, line) => ({
        line,
        assignee: null,
        ticked_by: null,
        ticked_at: null,
        ...item,
      })),
    };
  }

  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (down) {
      refused += 1;
      throw new TypeError("Failed to fetch");
    }
    if (expired) return expired === "opaque" ? opaqueRedirect() : signInPage();
    if (url === "/share/me") return reply(WHO);
    const match = /^\/share\/lists\/([^/]+)(?:\/(items|tick|clear|assign))?$/.exec(url);
    if (!match) return reply({ detail: "No such list" }, 404);
    const name = decodeURIComponent(match[1] ?? "");
    const action = match[2];
    if (!action) return reply(view(name));
    return write(url, name, action, init);
  });

  async function write(url: string, name: string, action: string, init?: RequestInit) {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    posts.push({ path: url, body });
    if (hang) {
      hang = false;
      return never(init?.signal);
    }
    // Another writer gets in between this write's read and its check.
    if (hooks > 0) {
      hooks -= 1;
      hook?.();
    }

    const note = notes.get(name);
    const current = note ? String(note.rev) : null;
    if (body.sha !== current) return reply({ detail: "Stale", current }, 409);
    if (unknownAssignee(action, body)) return reply({ detail: "Unbekannte Person" }, 422);

    notes.set(name, { rev: (note?.rev ?? 0) + 1, items: written(note?.items ?? [], action, body) });
    const answer = reply(view(name));
    if (lose) {
      // The write landed and the answer never came back.
      lose = false;
      down = loseThenDown;
      throw new TypeError("Failed to fetch");
    }
    return answer;
  }

  return {
    fetch,
    /** Every write the app sent, in order. */
    posts,
    /** Run before each of the next `times` writes is checked: another writer gets in. */
    beforeWrite: (run: () => void, times = 1) => {
      hook = run;
      hooks = times;
    },
    /** The next write lands, and its answer is lost on the way back. `thenDown` keeps the network down after it. */
    loseNextAnswer: (thenDown = false) => {
      lose = true;
      loseThenDown = thenDown;
    },
    /** Every share request answers as an expired session does: the sign-in page, or a redirect to another origin. */
    expireSession: (how: "html" | "opaque" = "html") => {
      expired = how;
    },
    sessionBack: () => {
      expired = null;
    },
    /** The next write never answers. */
    hangNext: () => {
      hang = true;
    },
    networkUp: () => {
      down = false;
    },
    /** How many requests the network refused while it was down. */
    refusals: () => refused,
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
