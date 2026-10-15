import { ChangedOnDisk, updateNote } from "@/lib/api";
import { noteBase } from "@/lib/note-base";

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
    if (status === 409) return Response.json({ detail: "Changed on disk" }, { status });
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

describe("updateNote", () => {
  it("names the text it read as the base", async () => {
    vault(["one"], [200]);

    await expect(updateNote("a.md", (text) => `${text}!`)).resolves.toMatchObject({
      content: "one!",
    });

    expect(await sent()).toEqual([{ content: "one!", base: noteBase("one") }]);
  });

  it("reads again on a 409 and applies the change to the new text", async () => {
    vault(["one", "two"], [409, 200]);
    const change = vi.fn((text: string) => `${text}!`);

    await updateNote("a.md", change);

    expect(change.mock.calls).toEqual([["one"], ["two"]]);
    expect(await sent()).toEqual([
      { content: "one!", base: noteBase("one") },
      { content: "two!", base: noteBase("two") },
    ]);
  });

  it("writes nothing where the change answers null, on the first read or a later one", async () => {
    vault(["one", "moved"], [409]);

    await expect(
      updateNote("a.md", (text) => (text === "one" ? "one!" : null)),
    ).resolves.toBeNull();

    expect(await sent()).toHaveLength(1);
  });

  it("gives up after three refusals, with no fourth write", async () => {
    vault(["one", "two", "three", "four"], [409, 409, 409, 200]);

    await expect(updateNote("a.md", (text) => `${text}!`)).rejects.toBeInstanceOf(ChangedOnDisk);

    expect(await sent()).toHaveLength(3);
  });
});
