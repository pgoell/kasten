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

  it("an add whose answer was lost is not added a second time", async () => {
    const share = fakeShare({ Einkauf: [], Todo: [] });
    vi.stubGlobal("fetch", share.fetch);
    const store = createListsStore();
    await vi.waitFor(() => expect(store.snapshot().lists.Einkauf).toBeDefined());

    share.loseNextAnswer();
    store.add("Einkauf", "Milch");

    await vi.waitFor(() => expect(store.snapshot().queue).toEqual([]));
    expect(share.items("Einkauf").map((item) => item.text)).toEqual(["Milch"]);
    store.close();
  });

  it("an op that meets three conflicts in a row stays in the queue", async () => {
    const share = fakeShare({ Einkauf: [], Todo: [] });
    vi.stubGlobal("fetch", share.fetch);
    const store = createListsStore();
    await vi.waitFor(() => expect(store.snapshot().lists.Einkauf).toBeDefined());

    share.beforeWrite(() => share.external("Einkauf", "Brot"), 3);
    store.add("Einkauf", "Eier");

    await vi.waitFor(() => expect(share.posts).toHaveLength(3));
    await vi.waitFor(() => expect(store.snapshot().queue).toHaveLength(1));
    expect(store.snapshot().errors).toEqual([]);

    // The next trigger sends it, now that the conflicts are over.
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(store.snapshot().queue).toEqual([]));
    expect(share.items("Einkauf").at(-1)?.text).toBe("Eier");
    store.close();
  });

  it("a write answered by the sign-in page stays queued", async () => {
    const share = fakeShare({ Einkauf: [], Todo: [] });
    vi.stubGlobal("fetch", share.fetch);
    const store = createListsStore();
    await vi.waitFor(() => expect(store.snapshot().lists.Einkauf).toBeDefined());

    share.signInNext();
    store.add("Einkauf", "Milch");

    await vi.waitFor(() => expect(store.snapshot().signIn).toBe(true));
    expect(store.snapshot().queue).toHaveLength(1);
    expect(store.snapshot().errors).toEqual([]);
    store.close();
  });

  it("two stores on one storage keep both tabs' offline adds", async () => {
    const share = fakeShare({ Einkauf: [], Todo: [] });
    vi.stubGlobal("fetch", share.fetch);
    setOnline(false);
    // Two tabs of one browser: both start before either adds anything.
    const tabA = createListsStore();
    const tabB = createListsStore();

    tabA.add("Einkauf", "Milch");
    tabB.add("Einkauf", "Brot");
    expect(JSON.parse(localStorage.getItem("kasten.lists.queue") ?? "[]")).toHaveLength(2);

    setOnline(true);
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() =>
      expect(
        share
          .items("Einkauf")
          .map((item) => item.text)
          .sort(),
      ).toEqual(["Brot", "Milch"]),
    );
    // Each add goes up once, even though both tabs were told the browser is back.
    expect(share.posts).toHaveLength(2);
    tabA.close();
    tabB.close();
  });
});
