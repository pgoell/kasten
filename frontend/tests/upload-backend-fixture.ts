/** A fake backend for the upload routes, shared by the asset and the Anki import tests. */

export const PIECE = 10 * 1024 * 1024;

/** One answer from the backend: a lost connection, a status, or a status with its body. */
export type Reply = "drop" | number | { status: number; body?: unknown; html?: true };

/**
 * The backend behind the upload routes, and every request sent to it in order.
 *
 * `pieces` answers each PUT in turn, `finishes` each POST that is not an upload,
 * and `polls` each GET of an import: "drop" as a lost connection, a number as
 * that status, an object as that status with that body. Past the end of a list
 * the request lands. A request reads as its method, its URL and what it carried.
 */
export function uploads(pieces: Reply[] = [], finishes: Reply[] = [], polls: Reply[] = []) {
  const sent: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body;
      const carried =
        body instanceof Blob ? ` ${body.size} bytes` : typeof body === "string" ? ` ${body}` : "";
      sent.push(`${init?.method ?? "GET"} ${url}${carried}`);
      if (url === "/api/uploads") {
        return { ok: true, status: 201, json: async () => ({ id: "u1" }) };
      }
      if (init?.method === "PUT") return reply(pieces.shift());
      if (url.startsWith("/api/anki/imports/")) return reply(polls.shift());
      return init?.method === "POST" ? reply(finishes.shift()) : reply(undefined);
    }),
  );
  return sent;
}

/** What `fetch` answers with for one `Reply`, which is the answer to a request that landed when none. */
function reply(answer: Reply | undefined) {
  // What `fetch` itself throws when the connection drops.
  if (answer === "drop") throw new TypeError("Failed to fetch");
  if (typeof answer === "object" && answer.html) {
    // A proxy's page or a Cloudflare one: HTML, with no JSON to read.
    return {
      ok: answer.status < 300,
      status: answer.status,
      headers: new Headers({ "content-type": "text/html" }),
      json: async () => {
        throw new SyntaxError("Unexpected token '<'");
      },
    };
  }
  if (typeof answer === "object") {
    return {
      ok: answer.status < 300,
      status: answer.status,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => answer.body,
    };
  }
  // A bare 5xx is Cloudflare's HTML page, which names no reason.
  if (answer !== undefined && answer >= 500) {
    return {
      ok: false,
      status: answer,
      headers: new Headers({ "content-type": "text/html" }),
      json: async () => {
        throw new SyntaxError("Unexpected token '<'");
      },
    };
  }
  if (answer !== undefined && answer >= 300) {
    return {
      ok: false,
      status: answer,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ detail: `The backend answered ${answer}` }),
    };
  }
  return {
    ok: true,
    status: 201,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => ({}),
  };
}
