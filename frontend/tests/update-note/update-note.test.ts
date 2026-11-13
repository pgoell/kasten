// @vitest-environment node
import { ChangedOnDisk, createNote, fetchNote, saveNote, updateNote } from "@/lib/core/api";
import { noteBase } from "@/lib/notes/note-base";
import { beginPress, endPress, pressEcho } from "@/lib/todo/todo-press-echo";
import { digestOf } from "@/lib/vault/events/vault-events";
import { updateWithTries } from "./stand-in";

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

/** The vault answering each GET with the next text, and each PUT with the next status. */
function vault(reads: string[], puts: number[]) {
  fetching.mockImplementation(async (request: Request) => {
    if (request.method === "GET") {
      return Response.json({ path: "a.md", content: reads.shift() });
    }
    const status = puts.shift() ?? 200;
    if (status !== 200) return Response.json({ detail: "Changed on disk" }, { status });
    const { content } = (await request.clone().json()) as { content: string };
    return Response.json({ path: "a.md", content });
  });
}

/** What each PUT carried, in order. */
async function sent(): Promise<{ content: string; base?: string }[]> {
  const puts = fetching.mock.calls
    .map(([request]) => request as Request)
    .filter((request) => request.method === "PUT");
  return Promise.all(puts.map((request) => request.clone().json()));
}

beforeEach(() => {
  fetching.mockReset();
});

// The stand-in the route tests mock `updateNote` with answers every case here as the real one does.
function sharedCases(
  update: (path: string, change: (text: string) => string | null) => Promise<unknown>,
) {
  it("names the text it read as the base", async () => {
    vault(["one"], [200]);

    await expect(update("a.md", (text) => `${text}!`)).resolves.toMatchObject({
      content: "one!",
    });

    expect(await sent()).toEqual([{ content: "one!", base: noteBase("one") }]);
  });

  it("reads again on a 409 and applies the change to the new text", async () => {
    vault(["one", "two"], [409, 200]);
    const change = vi.fn((text: string) => `${text}!`);

    await update("a.md", change);

    expect(change.mock.calls).toEqual([["one"], ["two"]]);
    expect(await sent()).toEqual([
      { content: "one!", base: noteBase("one") },
      { content: "two!", base: noteBase("two") },
    ]);
  });

  it("writes nothing where the change answers null, on the first read or a later one", async () => {
    vault(["one", "moved"], [409]);

    await expect(update("a.md", (text) => (text === "one" ? "one!" : null))).resolves.toBeNull();

    expect(await sent()).toHaveLength(1);
  });

  it("gives up after three refusals, with no fourth write", async () => {
    vault(["one", "two", "three", "four"], [409, 409, 409, 200]);

    await expect(update("a.md", (text) => `${text}!`)).rejects.toBeInstanceOf(ChangedOnDisk);

    expect(await sent()).toHaveLength(3);
  });

  it("throws anything but a refusal on the first try, with no second read", async () => {
    vault(["one", "two"], [500]);

    await expect(update("a.md", (text) => `${text}!`)).rejects.toThrow("failed with 500");

    expect(
      fetching.mock.calls.filter(([request]) => (request as Request).method === "GET"),
    ).toHaveLength(1);
  });
}

describe("updateNote", () => {
  sharedCases(updateNote);
});

describe("the tests' stand-in for updateNote", () => {
  sharedCases(updateWithTries(fetchNote, saveNote));
});

/** The vault answering each GET with "one" and each write once `release` runs: 409 while `refusals` last, then the text stamped. */
function heldVault(refusals = 0, status = 200) {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  fetching.mockImplementation(async (request: Request) => {
    const path = decodeURIComponent(new URL(request.url).pathname).replace("/api/files/", "");
    if (request.method === "GET") return Response.json({ path, content: "one" });
    if (refusals-- > 0) return Response.json({ detail: "Changed on disk" }, { status: 409 });
    const { content } = (await request.clone().json()) as { content: string };
    await gate;
    if (status !== 200) return Response.json({ detail: "boom" }, { status });
    return Response.json({ path, content: stamped(content) });
  });
  return { release };
}

/** What lands: the backend restamps `modified`, so the text sent is not the text on disk. */
const stamped = (content: string) => `---\nmodified: now\n---\n${content}`;

/** The event's answer, or "waiting" while it still waits on a save. */
const settled = (echo: Promise<boolean>) =>
  Promise.race([echo, new Promise((resolve) => setTimeout(() => resolve("waiting"), 20))]);

describe("a press's write whose event beats its answer (#1994)", () => {
  beforeEach(() => beginPress());
  afterEach(() => endPress());

  it("counts a save's own event as its echo though it arrives before the answer", async () => {
    const vault = heldVault();
    const saving = saveNote("save.md", "two");
    const echo = pressEcho("save.md", await digestOf(stamped("two")));
    vault.release();
    await saving;
    expect(await echo).toBe(true);
  });

  it("counts a created note's own event as its echo though it arrives before the answer", async () => {
    const vault = heldVault();
    const creating = createNote("create.md", "two");
    const echo = pressEcho("create.md", await digestOf(stamped("two")));
    vault.release();
    await creating;
    expect(await echo).toBe(true);
  });

  it("counts the event of a save retried after a 409 as its echo", async () => {
    const vault = heldVault(1);
    const updating = updateNote("retry.md", (text) => `${text}!`);
    await vi.waitFor(() => expect(fetching).toHaveBeenCalledTimes(4));
    const echo = pressEcho("retry.md", await digestOf(stamped("one!")));
    vault.release();
    await updating;
    expect(await echo).toBe(true);
  });

  it("asks again for another writer's event on a path a press is saving, once the save answers", async () => {
    const vault = heldVault();
    const saving = saveNote("other.md", "two");
    const echo = pressEcho("other.md", await digestOf("someone else's text"));
    expect(await settled(echo)).toBe("waiting");
    vault.release();
    await saving;
    expect(await echo).toBe(false);
  });

  it("asks again once a save that fails has answered", async () => {
    const vault = heldVault(0, 500);
    const saving = saveNote("fails.md", "two").catch((error: Error) => error);
    const echo = pressEcho("fails.md", await digestOf(stamped("two")));
    vault.release();
    expect(await saving).toBeInstanceOf(Error);
    expect(await echo).toBe(false);
  });
});

it("waits on no save made outside a press", async () => {
  const vault = heldVault();
  const saving = saveNote("alone.md", "two");
  expect(await settled(pressEcho("alone.md", await digestOf(stamped("two"))))).toBe(false);
  vault.release();
  await saving;
});
