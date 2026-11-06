import "fake-indexeddb/auto";
import { onlineManager, QueryClient } from "@tanstack/react-query";
import { forgetKeptReads, keepReads, kept } from "@/lib/app/kept-reads";

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
});
