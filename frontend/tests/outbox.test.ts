import "fake-indexeddb/auto";
import { readClock } from "@/lib/clock";
import { flush, keep, reset, waiting } from "@/lib/outbox";

/**
 * The outbox a dump waits in until the vault has it.
 *
 * Against fake-indexeddb, which is a whole IndexedDB in memory, so what these
 * hold is the store itself: what is kept, what goes out, in which order, and
 * what stays when the answer is not a 2xx.
 */

/** Drop the database, which only goes once the outbox has let go of it. */
function dropped(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase("kasten-outbox");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/** What each POST carried, in the order they went. */
function bodies(sent: ReturnType<typeof vi.fn>): { id: string; text: string; date: string }[] {
  return sent.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
}

/** A fetch that answers every call with `answer`, or rejects as offline does. */
function answering(answer: () => Response | Promise<Response>) {
  const sent = vi.fn(async (_url: string, _init: RequestInit) => answer());
  vi.stubGlobal("fetch", sent);
  return sent;
}

function offline() {
  return answering(() => {
    throw new TypeError("Failed to fetch");
  });
}

const ok = () => new Response(JSON.stringify({ path: "x.md", content: "" }), { status: 200 });

describe("the outbox", () => {
  beforeEach(async () => {
    await reset();
    await dropped();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("keeps a dump that cannot be sent and lists it as waiting", async () => {
    offline();

    await keep("on a train", "2026-10-16");
    const state = await flush();

    expect(state.failure).toEqual({ kind: "offline" });
    expect(state.waiting.map((dump) => dump.text)).toEqual(["on a train"]);
    expect((await waiting()).map((dump) => dump.text)).toEqual(["on a train"]);
  });

  it("sends three waiting dumps in typing order, each once, and empties the store", async () => {
    offline();
    await keep("first", "2026-10-16");
    await keep("second", "2026-10-16");
    await keep("third", "2026-10-16");
    await flush();

    const sent = answering(ok);
    const state = await flush();

    expect(bodies(sent).map((body) => body.text)).toEqual(["first", "second", "third"]);
    expect(sent).toHaveBeenCalledWith(
      "/api/dump",
      expect.objectContaining({ method: "POST", redirect: "manual", credentials: "same-origin" }),
    );
    expect(state).toEqual({ waiting: [], failure: null });
    expect(await waiting()).toEqual([]);
  });

  it("resends the same id after an answer that was lost on the way back", async () => {
    // The server wrote it and the answer never came: the fetch saw the body go
    // out and then failed, which from here looks the same as no signal.
    const sent = vi.fn(async (_url: string, _init: RequestInit): Promise<Response> => {
      if (sent.mock.calls.length === 1) throw new TypeError("Failed to fetch");
      return ok();
    });
    vi.stubGlobal("fetch", sent);

    await keep("said once", "2026-10-16");
    await flush();
    await flush();

    const [first, second] = bodies(sent);
    expect(first?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toEqual(first);
    expect(second).toEqual({ id: first?.id, text: "said once", date: "2026-10-16" });
    expect(await waiting()).toEqual([]);
  });

  it("sends the day the dump was typed on, not the day it went", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 16, 23, 58));
    offline();

    await keep("before midnight", readClock(new Date()).date);
    await flush();

    vi.setSystemTime(new Date(2026, 9, 17, 0, 5));
    const sent = answering(ok);
    await flush();

    expect(readClock(new Date()).date).toBe("2026-10-17");
    expect(bodies(sent).map((body) => body.date)).toEqual(["2026-10-16"]);
  });

  it("keeps the dump through a sign-in redirect or a 401 and says to sign in again", async () => {
    await keep("behind the proxy", "2026-10-16");

    // What `redirect: "manual"` turns oauth2-proxy's 302 into.
    answering(() => ({ ok: false, status: 0, type: "opaqueredirect" }) as Response);
    const redirected = await flush();
    expect(redirected.failure).toEqual({ kind: "sign-in" });
    expect(redirected.waiting).toHaveLength(1);

    answering(() => new Response("", { status: 401 }));
    const refused = await flush();
    expect(refused.failure).toEqual({ kind: "sign-in" });
    expect((await waiting()).map((dump) => dump.text)).toEqual(["behind the proxy"]);
  });

  it("keeps a dump the server refuses and passes on the server's words", async () => {
    answering(
      () =>
        new Response(JSON.stringify({ detail: "Nothing to capture" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
    );

    await keep("refused", "2026-10-16");
    const state = await flush();

    expect(state.failure).toEqual({ kind: "refused", message: "Nothing to capture" });
    expect(state.waiting.map((dump) => dump.text)).toEqual(["refused"]);
  });

  it("still holds the waiting dumps after the app is closed and opened again", async () => {
    offline();
    await keep("before the close", "2026-10-16");
    await keep("and another", "2026-10-16");

    await reset();

    expect((await waiting()).map((dump) => dump.text)).toEqual(["before the close", "and another"]);
  });

  it("sends each dump once when two flushes start together", async () => {
    offline();
    await keep("one", "2026-10-16");
    await keep("two", "2026-10-16");

    const sent = answering(ok);
    await Promise.all([flush(), flush()]);

    expect(bodies(sent).map((body) => body.text)).toEqual(["one", "two"]);
  });
});
