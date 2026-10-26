import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { noteBase } from "@/lib/note-base";
import { useSittingWrites } from "@/lib/use-sitting-writes";

// Stubbed before `api.ts` loads, because `openapi-fetch` takes `fetch` and
// `Request` off the global once, when the client is made. Node's `Request`
// refuses the relative path a browser resolves against the page.
const fetching = vi.hoisted(() => {
  const stub = vi.fn();
  vi.stubGlobal("fetch", stub);
  vi.stubGlobal(
    "Request",
    class extends Request {
      constructor(input: string, init?: RequestInit) {
        super(new URL(input, "http://kasten.test"), init);
      }
    },
  );
  return stub;
});

/** The text the vault adds to a note it takes, so its answer is not the text sent. */
const stamped = (text: string) => `${text}\n<!-- stamped -->`;

/**
 * The vault answering each GET with the next text, and each PUT with the next
 * answer: a status, or an error the connection fails with. A PUT past the list
 * lands.
 */
function vault(reads: string[], puts: (number | Error)[]) {
  fetching.mockImplementation(async (request: Request) => {
    if (request.method === "GET") {
      return Response.json({ path: "a.md", content: reads.shift() });
    }
    const answer = puts.shift() ?? 200;
    if (answer instanceof Error) throw answer;
    if (answer === 409) return Response.json({ detail: "Changed on disk" }, { status: 409 });
    if (answer !== 200) return new Response("", { status: answer });
    const { content } = (await request.clone().json()) as { content: string };
    return Response.json({ path: "a.md", content: stamped(content) });
  });
}

/** What each PUT carried, in order. */
async function sent(): Promise<{ content: string; base?: string }[]> {
  const puts = fetching.mock.calls
    .map(([request]) => request as Request)
    .filter((request) => request.method === "PUT");
  return Promise.all(puts.map((request) => request.clone().json()));
}

/** The hook over a fresh query client, with its setters as mocks. */
function setup() {
  const client = new QueryClient();
  const setFailed = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useSittingWrites(vi.fn(), setFailed), { wrapper });
  return { ...hook, client, setFailed };
}

beforeEach(() => {
  fetching.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useSittingWrites retrying a write the backend dropped (#1135)", () => {
  it("#1135 A1 a rating whose write gets a 502 and then lands keeps the rating", async () => {
    vault([], [502, 200]);
    const { result, setFailed } = setup();

    const write = result.current("a.md", "old", "new");
    await vi.advanceTimersByTimeAsync(1000);

    expect(await write).toBeNull();
    expect(setFailed).not.toHaveBeenCalled();
    expect(await sent()).toEqual([
      { content: "new", base: noteBase("old") },
      { content: "new", base: noteBase("old") },
    ]);
  });

  it("#1135 A2 a 503 is retried the same way and the rating keeps", async () => {
    vault([], [503, 200]);
    const { result, setFailed } = setup();

    const write = result.current("a.md", "old", "new");
    await vi.advanceTimersByTimeAsync(1000);

    expect(await write).toBeNull();
    expect(setFailed).not.toHaveBeenCalled();
    expect(await sent()).toEqual([
      { content: "new", base: noteBase("old") },
      { content: "new", base: noteBase("old") },
    ]);
  });

  it("#1135 A2 a 504 is retried the same way and the rating keeps", async () => {
    vault([], [504, 200]);
    const { result, setFailed } = setup();

    const write = result.current("a.md", "old", "new");
    await vi.advanceTimersByTimeAsync(1000);

    expect(await write).toBeNull();
    expect(setFailed).not.toHaveBeenCalled();
    expect(await sent()).toEqual([
      { content: "new", base: noteBase("old") },
      { content: "new", base: noteBase("old") },
    ]);
  });

  it("#1135 A3 a write that fails with a network error is retried the same way", async () => {
    vault([], [new TypeError("Failed to fetch"), 200]);
    const { result, setFailed } = setup();

    const write = result.current("a.md", "old", "new");
    await vi.advanceTimersByTimeAsync(1000);

    expect(await write).toBeNull();
    expect(setFailed).not.toHaveBeenCalled();
    expect(await sent()).toEqual([
      { content: "new", base: noteBase("old") },
      { content: "new", base: noteBase("old") },
    ]);
  });

  it("#1135 A4 a write the backend drops for a minute fails then, and the note is read again", async () => {
    vault(["the vault's text"], Array(8).fill(502));
    const { result, setFailed } = setup();

    const write = result.current("a.md", "old", "new");
    await vi.advanceTimersByTimeAsync(59_999);
    expect(await sent()).toHaveLength(7);
    expect(setFailed).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await write;
    expect(await sent()).toHaveLength(8);
    expect(setFailed).toHaveBeenCalledWith("PUT /api/files/a.md failed with 502");
    expect(fetching.mock.calls.map(([request]) => (request as Request).method)).toEqual([
      ...Array(8).fill("PUT"),
      "GET",
    ]);
  });

  it("#1135 A5 a refusal from the vault fails at once with one write, as before", async () => {
    vault(["the vault's text"], [409]);
    const { result, setFailed } = setup();

    await result.current("a.md", "old", "new");
    await vi.advanceTimersByTimeAsync(60_000);

    expect(await sent()).toHaveLength(1);
    expect(setFailed).toHaveBeenCalledWith("Changed on disk");
  });

  it("#1135 A6 a retry the vault refuses because the note moved on fails at once and sends nothing more", async () => {
    vault(["the vault's text"], [502, 409]);
    const { result, setFailed } = setup();

    const write = result.current("a.md", "old", "new");
    await vi.advanceTimersByTimeAsync(1000);
    await write;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(await sent()).toHaveLength(2);
    expect(setFailed).toHaveBeenCalledWith("Changed on disk");
  });

  it("#1135 A7 a retried write that lands invalidates the cards", async () => {
    vault([], [502, 200]);
    const { result, client } = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");

    const write = result.current("a.md", "old", "new");
    await vi.advanceTimersByTimeAsync(1000);
    await write;

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["cards"] });
  });

  it("#1135 I1 a write made while one retries waits behind it and names its answer as the base", async () => {
    vault([], [502, 200, 200]);
    const { result } = setup();

    const first = result.current("a.md", "old", "new");
    const second = result.current("a.md", "new", "newer");
    await vi.advanceTimersByTimeAsync(1000);

    expect(await first).toBeNull();
    expect(await second).toBeNull();
    expect(await sent()).toEqual([
      { content: "new", base: noteBase("old") },
      { content: "new", base: noteBase("old") },
      { content: "newer", base: noteBase(stamped("new")) },
    ]);
  });

  it("#1135 I2 an undo pressed while a write retries waits behind it and settles as landed", async () => {
    vault([], [502, 200, 200]);
    const { result } = setup();

    const write = result.current("a.md", "old", "new");
    const undo = result.current("a.md", "new", "old");
    await vi.advanceTimersByTimeAsync(1000);

    expect(await write).toBeNull();
    expect(await undo).toBeNull();
    expect(await sent()).toEqual([
      { content: "new", base: noteBase("old") },
      { content: "new", base: noteBase("old") },
      { content: "old", base: noteBase(stamped("new")) },
    ]);
  });

  it("#1135 I3 a 500 fails at once with one write and is not retried", async () => {
    vault(["the vault's text"], [500]);
    const { result, setFailed } = setup();

    await result.current("a.md", "old", "new");
    await vi.advanceTimersByTimeAsync(60_000);

    expect(await sent()).toHaveLength(1);
    expect(setFailed).toHaveBeenCalledWith("PUT /api/files/a.md failed with 500");
  });

  it("#1135 I3 a 404 fails at once with one write and is not retried", async () => {
    vault(["the vault's text"], [404]);
    const { result, setFailed } = setup();

    await result.current("a.md", "old", "new");
    await vi.advanceTimersByTimeAsync(60_000);

    expect(await sent()).toHaveLength(1);
    expect(setFailed).toHaveBeenCalledWith("PUT /api/files/a.md failed with 404");
  });

  it("#1135 I4 a write still retrying when its component unmounts keeps going and lands", async () => {
    vault([], [502, 200]);
    const { result, unmount } = setup();

    const write = result.current("a.md", "old", "new");
    unmount();
    await vi.advanceTimersByTimeAsync(1000);

    expect(await write).toBeNull();
    expect(await sent()).toHaveLength(2);
  });
});
