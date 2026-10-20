import { createListsStore } from "@/lists/lists-store";
import { fakeShare, setOnline } from "./lists-fixture";

class FakeEventSource {
  static last: FakeEventSource | undefined;
  readonly url: string;
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.last = this;
  }

  close() {}
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "onLine");
});

describe("the lists store", () => {
  it("a stale sha is re-read and the add goes through with the new sha, keeping both writers' items", async () => {
    const share = fakeShare({ Einkauf: [{ text: "Milch", done: false }], Todo: [] });
    vi.stubGlobal("fetch", share.fetch);
    const store = createListsStore();
    await vi.waitFor(() => expect(store.snapshot().lists.Einkauf).toBeDefined());

    share.beforeWrite(() => share.external("Einkauf", "Brot"));
    store.add("Einkauf", "Eier");

    await vi.waitFor(() =>
      expect(share.items("Einkauf").map((item) => item.text)).toEqual(["Brot", "Milch", "Eier"]),
    );
    expect(share.posts.at(-1)).toEqual({
      path: "/share/lists/Einkauf/items",
      body: { text: "Eier", sha: "2" },
    });
    store.close();
  });

  it("an add made offline stays in the queue across a reload and goes up in order when the browser comes back online", async () => {
    const share = fakeShare({ Einkauf: [], Todo: [] });
    vi.stubGlobal("fetch", share.fetch);
    setOnline(false);

    const first = createListsStore();
    first.add("Einkauf", "Milch");
    first.add("Einkauf", "Brot");
    first.close();

    const reloaded = createListsStore();
    expect(reloaded.snapshot().queue.map((op) => ("text" in op ? op.text : ""))).toEqual([
      "Milch",
      "Brot",
    ]);
    expect(share.posts).toEqual([]);

    setOnline(true);
    window.dispatchEvent(new Event("online"));

    await vi.waitFor(() =>
      expect(share.items("Einkauf").map((item) => item.text)).toEqual(["Milch", "Brot"]),
    );
    expect(share.posts.map((post) => post.body.text)).toEqual(["Milch", "Brot"]);
    expect(reloaded.snapshot().queue).toEqual([]);
    reloaded.close();
  });

  it("a tick resolves its line by the item's text after the list changed under it", async () => {
    const share = fakeShare({ Einkauf: [{ text: "Milch", done: false }], Todo: [] });
    vi.stubGlobal("fetch", share.fetch);
    const store = createListsStore();
    await vi.waitFor(() => expect(store.snapshot().lists.Einkauf).toBeDefined());

    // Brot goes in above Milch, so Milch's line moves from 0 to 1 under the read.
    share.beforeWrite(() => share.external("Einkauf", "Brot"));
    store.tick("Einkauf", "Milch", true);

    await vi.waitFor(() =>
      expect(share.items("Einkauf")).toEqual([
        { text: "Brot", done: false },
        { text: "Milch", done: true },
      ]),
    );
    store.close();
  });

  it("an event on /share/events refetches the list", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const share = fakeShare({ Einkauf: [{ text: "Milch", done: false }], Todo: [] });
    vi.stubGlobal("fetch", share.fetch);
    const store = createListsStore();
    await vi.waitFor(() => expect(store.snapshot().lists.Einkauf?.items).toHaveLength(1));

    // The write comes from kasten, so nothing here has seen it yet.
    share.external("Einkauf", "Brot");
    FakeEventSource.last?.onmessage?.(new MessageEvent("message", { data: "{}" }));

    await vi.waitFor(() =>
      expect(store.snapshot().lists.Einkauf?.items.map((item) => item.text)).toEqual([
        "Brot",
        "Milch",
      ]),
    );
    expect(FakeEventSource.last?.url).toBe("/share/events");
    store.close();
  });
});
