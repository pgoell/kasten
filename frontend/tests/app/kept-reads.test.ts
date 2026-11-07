// @vitest-environment node
import "fake-indexeddb/auto";
import { onlineManager, QueryClient } from "@tanstack/react-query";
import { forgetKeptReads, keepReads, kept } from "@/lib/app/kept-reads";
import { NoteMissing } from "@/lib/core/api";

/**
 * Vault reads kept in IndexedDB so a page reloaded with no signal still shows them. Against
 * fake-indexeddb; each test starts on an empty database.
 */

function dropped(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase("kasten-reads");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/** A page: a fresh client with the store attached, as a reload gives. */
function page(): { client: QueryClient; stop: () => void } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { client, stop: keepReads(client) };
}

/** IndexedDB answers on later tasks, so wait for the writes and reads in flight to land. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

const failing = () => Promise.reject(new TypeError("Failed to fetch"));
const gone = () => Promise.reject(new NoteMissing("a.md"));

/** A page whose first visit read `a.md`, stopped, so the next page starts from its record. */
async function readBefore(): Promise<void> {
  const first = page();
  await first.client.fetchQuery({ queryKey: ["note", "a.md"], queryFn: async () => "# A" });
  await settle();
  first.stop();
}

describe("kept reads", () => {
  afterEach(async () => {
    onlineManager.setOnline(true);
    await forgetKeptReads();
    await dropped();
    vi.useRealTimers();
  });

  it("keeps the vault's reads and nothing else", () => {
    expect(kept(["note", "a.md"])).toBe(true);
    expect(kept(["files"])).toBe(true);
    expect(kept(["mentions", "a.md", false])).toBe(true);
    expect(kept(["log", "2026-11-01", "2026-11-06"])).toBe(true);
    expect(kept(["todos", false])).toBe(true);
    expect(kept(["note", "a.md", "history"])).toBe(false);
    expect(kept(["finance", "transactions"])).toBe(false);
    expect(kept(["tokens"])).toBe(false);
  });

  it("opens a note read before when the next page has no signal", async () => {
    const first = page();
    await first.client.fetchQuery({ queryKey: ["note", "a.md"], queryFn: async () => "# A" });
    await settle();
    first.stop();

    onlineManager.setOnline(false);
    const second = page();
    void second.client.prefetchQuery({ queryKey: ["note", "a.md"], queryFn: failing });
    await settle();
    expect(second.client.getQueryData(["note", "a.md"])).toBe("# A");
    second.stop();
  });

  it("shows the kept note when the read fails on a weak signal", async () => {
    const first = page();
    await first.client.fetchQuery({ queryKey: ["note", "a.md"], queryFn: async () => "# A" });
    await settle();
    first.stop();

    const second = page();
    await second.client.prefetchQuery({ queryKey: ["note", "a.md"], queryFn: failing });
    await settle();
    expect(second.client.getQueryData(["note", "a.md"])).toBe("# A");
    second.stop();
  });

  it("lets a fresh answer win over the kept one", async () => {
    const first = page();
    await first.client.fetchQuery({ queryKey: ["note", "a.md"], queryFn: async () => "old" });
    await settle();
    first.stop();

    const second = page();
    await second.client.fetchQuery({ queryKey: ["note", "a.md"], queryFn: async () => "new" });
    await settle();
    expect(second.client.getQueryData(["note", "a.md"])).toBe("new");
    second.stop();
  });

  it("keeps text the page put in the cache itself, as the autosave does", async () => {
    const first = page();
    await first.client.fetchQuery({ queryKey: ["note", "a.md"], queryFn: async () => "typed" });
    first.client.setQueryData(["note", "a.md"], "typed more");
    await settle();
    first.stop();

    onlineManager.setOnline(false);
    const second = page();
    void second.client.prefetchQuery({ queryKey: ["note", "a.md"], queryFn: failing });
    await settle();
    expect(second.client.getQueryData(["note", "a.md"])).toBe("typed more");
    second.stop();
  });

  it("never keeps finance", async () => {
    const first = page();
    await first.client.fetchQuery({ queryKey: ["finance", "x"], queryFn: async () => [1] });
    await settle();
    first.stop();

    onlineManager.setOnline(false);
    const second = page();
    void second.client.prefetchQuery({ queryKey: ["finance", "x"], queryFn: failing });
    await settle();
    expect(second.client.getQueryData(["finance", "x"])).toBeUndefined();
    second.stop();
  });

  it("drops a read older than a week", async () => {
    const first = page();
    await first.client.fetchQuery({ queryKey: ["files"], queryFn: async () => ["a.md"] });
    await settle();
    first.stop();

    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 8 * 24 * 60 * 60 * 1000 });
    onlineManager.setOnline(false);
    const second = page();
    void second.client.prefetchQuery({ queryKey: ["files"], queryFn: failing });
    await settle();
    expect(second.client.getQueryData(["files"])).toBeUndefined();
    second.stop();
  });

  it("drops the kept text of a note the vault no longer has", async () => {
    await readBefore();
    const second = page();
    const read = second.client.prefetchQuery({ queryKey: ["note", "a.md"], queryFn: gone });
    await settle();
    await read;
    await settle();
    const state = second.client.getQueryState(["note", "a.md"]);
    expect(state?.data).toBeUndefined();
    expect(state?.error).toBeInstanceOf(NoteMissing);
    second.stop();

    onlineManager.setOnline(false);
    const third = page();
    void third.client.prefetchQuery({ queryKey: ["note", "a.md"], queryFn: failing });
    await settle();
    expect(third.client.getQueryData(["note", "a.md"])).toBeUndefined();
    third.stop();
  });

  it("does not restore over a note the vault said is gone before the record was read", async () => {
    await readBefore();
    const second = page();
    // The 404 lands in the same task as the add, before IndexedDB answers.
    second.client.getQueryCache().build(second.client, { queryKey: ["note", "a.md"] });
    second.client
      .getQueryCache()
      .find({ queryKey: ["note", "a.md"] })
      ?.setState({
        status: "error",
        error: new NoteMissing("a.md"),
      });
    await settle();
    expect(second.client.getQueryData(["note", "a.md"])).toBeUndefined();
    second.stop();
  });

  it("keeps a note read live when the vault later says it is gone", async () => {
    await readBefore();
    const second = page();
    await second.client.fetchQuery({ queryKey: ["note", "a.md"], queryFn: async () => "# A live" });
    await settle();
    await second.client
      .fetchQuery({ queryKey: ["note", "a.md"], queryFn: gone, staleTime: 0 })
      .catch((error: unknown) => {
        if (!(error instanceof NoteMissing)) throw error;
      });
    await settle();
    expect(second.client.getQueryData(["note", "a.md"])).toBe("# A live");
    second.stop();
  });

  it("keeps text typed over a restored note when the vault later says it is gone", async () => {
    await readBefore();
    const second = page();
    second.client.getQueryCache().build(second.client, { queryKey: ["note", "a.md"] });
    await settle();
    expect(second.client.getQueryData(["note", "a.md"])).toBe("# A");
    second.client.setQueryData(["note", "a.md"], "# A typed");
    await second.client
      .fetchQuery({ queryKey: ["note", "a.md"], queryFn: gone, staleTime: 0 })
      .catch((error: unknown) => {
        if (!(error instanceof NoteMissing)) throw error;
      });
    await settle();
    expect(second.client.getQueryData(["note", "a.md"])).toBe("# A typed");
    second.stop();
  });
});
