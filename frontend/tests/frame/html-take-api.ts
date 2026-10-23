/**
 * The two requests a take makes, answered in place of the vault: the dump the
 * outbox sends, and the daily note the take reads back for its Undo (#787).
 *
 * The API client takes `fetch` when it is made, so this installs when the module
 * loads, which must be before `@/lib/api-client` does. Each take test file imports
 * it first. Anything else goes to the real fetch.
 */

const real = window.fetch.bind(window);

/** What the take has written so far, and the note it reads back. */
export const api = {
  /** The daily note the take writes to, which the test sets from the clock. */
  daily: "",
  /** The text of each dump the outbox sent, in order. */
  dumps: [] as string[],
  /** The daily note as the vault holds it: its `## Dump` with the dumps in it. */
  note: "",
  /** Each write to the daily note, with the base it named. */
  puts: [] as { content: string; base?: string }[],
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Whether `url` is the daily note's address, which the client encodes its path into. */
function isDaily(url: URL): boolean {
  const prefix = "/api/files/";
  return (
    url.pathname.startsWith(prefix) &&
    decodeURIComponent(url.pathname.slice(prefix.length)) === api.daily
  );
}

const stub = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  // The client sends a Request; the outbox sends a URL and an init.
  const request = input instanceof Request ? input : undefined;
  const url = new URL(request?.url ?? String(input), window.location.href);
  const method = (request?.method ?? init?.method ?? "GET").toUpperCase();

  if (url.pathname === "/api/dump" && method === "POST") {
    const { text } = JSON.parse(String(init?.body)) as { text: string };
    api.dumps.push(text);
    api.note = `## Dump\n\n${api.dumps.join("\n\n")}\n`;
    return json({ path: api.daily, content: api.note });
  }
  if (isDaily(url) && method === "GET") return json({ path: api.daily, content: api.note });
  if (isDaily(url) && method === "PUT" && request) {
    const body = JSON.parse(await request.text()) as { content: string; base?: string };
    api.puts.push(body);
    api.note = body.content;
    return json({ path: api.daily, content: api.note });
  }
  return real(input, init);
};

globalThis.fetch = stub as typeof fetch;

/** Clears what the take has written, and names the daily note the take will write to. */
export function resetApi(daily: string) {
  api.daily = daily;
  api.dumps = [];
  api.note = "## Dump\n";
  api.puts = [];
}
