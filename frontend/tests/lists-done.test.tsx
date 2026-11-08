import { fireEvent, render, screen, within } from "@testing-library/react";
import { ListsApp } from "@/lists/lists-app";
import { createListsStore, type ListData } from "@/lists/lists-store";
import { localDay, requestFor } from "@/lists/lists-view";
import { fakeShare, type Seed, setOnline } from "./lists-fixture";

/** Stub `/share` with the seed and draw the app. */
function open(seed: Record<string, Seed[]>) {
  const share = fakeShare(seed);
  vi.stubGlobal("fetch", share.fetch);
  render(<ListsApp />);
  return share;
}

/** The words of the done items, in the order they show. */
const doneWords = () =>
  within(screen.getByRole("region", { name: "Erledigt" }))
    .getAllByRole("checkbox")
    .map((box) => box.getAttribute("aria-label"));

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "onLine");
});

describe("the done group", () => {
  it("#810 A7 the folded done group shows the latest three ticks, and the heading unfolds the rest", async () => {
    const tick = (day: number) => `2026-10-${day}T10:00:00Z`;
    open({
      Einkauf: [
        { text: "Milch", done: false },
        { text: "Alt", done: true, ticked_at: tick(20) },
        { text: "Neu", done: true, ticked_at: tick(24) },
        { text: "Mittel", done: true, ticked_at: tick(22) },
        { text: "Frisch", done: true, ticked_at: tick(23) },
        { text: "Uralt", done: true, ticked_at: tick(19) },
      ],
      Todo: [],
    });

    const heading = await screen.findByRole("button", { name: "Erledigt 5" });
    expect(heading).toHaveAttribute("aria-expanded", "false");
    expect(doneWords()).toEqual(["Neu", "Frisch", "Mittel"]);

    fireEvent.click(heading);
    expect(heading).toHaveAttribute("aria-expanded", "true");
    expect(doneWords()).toEqual(["Neu", "Frisch", "Mittel", "Alt", "Uralt"]);
  });

  it("#810 A7 each done item names who ticked it and when, and nothing when neither is known", async () => {
    // Monday 25 October 2026 is a Sunday; the local clock is what the line shows.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 25, 12, 0));
    open({
      Einkauf: [
        {
          text: "Brot",
          done: true,
          ticked_by: "Alicia",
          ticked_at: new Date(2026, 9, 19, 18, 4).toISOString(),
        },
        {
          text: "Eier",
          done: true,
          ticked_by: "Pascal",
          ticked_at: new Date(2026, 9, 12, 18, 4).toISOString(),
        },
        {
          text: "Milch",
          done: true,
          ticked_by: null,
          ticked_at: new Date(2026, 9, 24, 9, 5).toISOString(),
        },
        { text: "Zitronen", done: true, ticked_by: null, ticked_at: null },
      ],
      Todo: [],
    });

    const lines = async () =>
      within(await screen.findByRole("region", { name: "Erledigt" }))
        .queryAllByText(/^abgehakt/)
        .map((line) => line.textContent);
    // The latest three are shown, and Zitronen, with no time, is among the rest.
    expect(await lines()).toEqual([
      "abgehakt Sa 09:05",
      "abgehakt von Alicia, Mo 18:04",
      "abgehakt von Pascal, 12.10. 18:04",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Erledigt 4" }));
    expect(doneWords()).toEqual(["Milch", "Brot", "Eier", "Zitronen"]);
    expect(await lines()).toHaveLength(3);
  });

  it("#810 A2 the lists app's labels are the German words", async () => {
    open({
      Einkauf: [
        { text: "Milch", done: false, assignee: "[[Alicia]]" },
        { text: "Eier", done: false },
        { text: "Brot", done: true, ticked_by: "Alicia" },
      ],
      Todo: [],
    });

    expect(await screen.findByRole("heading", { name: "Listen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Einkauf 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Todo 0" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alle" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Meine" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Erledigt 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Leeren" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Eintrag" })).toHaveAttribute(
      "placeholder",
      "Eintrag",
    );
    expect(screen.getByRole("button", { name: "Hinzufügen" })).toBeInTheDocument();
    expect(screen.getByText("abgehakt von Alicia")).toBeInTheDocument();
    // Eier, open, and Brot, done, have nobody yet.
    expect(screen.getAllByRole("button", { name: "Wer?" })).toHaveLength(2);

    fireEvent.click(screen.getAllByRole("button", { name: "Wer?" })[0] as HTMLElement);
    expect(screen.getByRole("menuitemradio", { name: "Niemand" })).toBeInTheDocument();
  });

  it("#810 A8 Hinzufügen adds the item as Enter does and empties the field", async () => {
    const share = open({ Einkauf: [], Todo: [] });
    await screen.findByText("Nichts auf der Liste");

    const field = screen.getByRole("textbox", { name: "Eintrag" });
    fireEvent.change(field, { target: { value: "Brot" } });
    fireEvent.click(screen.getByRole("button", { name: "Hinzufügen" }));

    expect(await screen.findByRole("checkbox", { name: "Brot" })).toBeInTheDocument();
    expect(field).toHaveValue("");
    expect(share.posts).toEqual([
      { path: "/share/lists/Einkauf/items", body: { text: "Brot", sha: "1" } },
    ]);
  });

  it("#810 A8 the field and Hinzufügen are the last thing on the page, in a composer that sticks to the bottom", async () => {
    open({ Einkauf: [{ text: "Milch", done: false }], Todo: [] });
    await screen.findByRole("checkbox", { name: "Milch" });

    const composer = screen.getByRole("textbox", { name: "Eintrag" }).closest("footer");
    expect(composer).toContainElement(screen.getByRole("button", { name: "Hinzufügen" }));
    expect(composer?.parentElement?.lastElementChild).toBe(composer);
  });
});

describe("a tick's day (#1513)", () => {
  const PRESSED = new Date(2026, 10, 3, 23, 50);
  const SENT = new Date(2026, 10, 4, 0, 10);

  /** Stub `/share`, go offline at 23:50, and make a store there. */
  function offlineBeforeMidnight(seed: Record<string, Seed[]>) {
    const share = fakeShare(seed);
    vi.stubGlobal("fetch", share.fetch);
    setOnline(false);
    vi.setSystemTime(PRESSED);
    return { share, store: createListsStore() };
  }

  function onlineAfterMidnight(): void {
    vi.setSystemTime(SENT);
    setOnline(true);
    window.dispatchEvent(new Event("online"));
  }

  it("a tick queued offline before midnight and sent after it, across a reload, sends the day it was pressed", async () => {
    const { share, store } = offlineBeforeMidnight({
      Einkauf: [{ text: "Milch", done: false }],
      Todo: [],
    });
    store.tick("Einkauf", "Milch", true);
    store.close();

    const reloaded = createListsStore();
    onlineAfterMidnight();

    await vi.waitFor(() => expect(reloaded.snapshot().queue).toEqual([]));
    expect(share.posts).toEqual([
      {
        path: "/share/lists/Einkauf/tick",
        body: { line: 0, done: true, sha: "1", day: "2026-11-03" },
      },
    ]);
    expect(share.items("Einkauf")[0]?.done).toBe(true);
    reloaded.close();
  });

  it("a tick an older build queued with no day still goes up once, with the device's day", async () => {
    const share = fakeShare({ Einkauf: [{ text: "Milch", done: false }], Todo: [] });
    vi.stubGlobal("fetch", share.fetch);
    localStorage.setItem(
      "kasten.lists.queue",
      JSON.stringify([{ kind: "tick", list: "Einkauf", text: "Milch", done: true, id: "old" }]),
    );
    const store = createListsStore();

    await vi.waitFor(() => expect(store.snapshot().queue).toEqual([]));
    expect(share.posts).toHaveLength(1);
    expect(share.posts[0]?.body.day).toBe(localDay(new Date()));
    expect(share.items("Einkauf")[0]?.done).toBe(true);
    store.close();
  });

  it("a tick that meets a stale sha is sent again with the day it was pressed", async () => {
    const { share, store } = offlineBeforeMidnight({
      Einkauf: [{ text: "Milch", done: false }],
      Todo: [],
    });
    store.tick("Einkauf", "Milch", true);
    share.beforeWrite(() => share.external("Einkauf", "Brot"));
    onlineAfterMidnight();

    await vi.waitFor(() => expect(store.snapshot().queue).toEqual([]));
    expect(share.posts.map((post) => post.body.day)).toEqual(["2026-11-03", "2026-11-03"]);
    expect(share.items("Einkauf").find((item) => item.text === "Milch")?.done).toBe(true);
    store.close();
  });

  it("an untick queued offline across midnight goes up once, to its own list", async () => {
    const { share, store } = offlineBeforeMidnight({
      Einkauf: [{ text: "Milch", done: true }],
      Todo: [{ text: "Milch", done: true }],
    });
    store.tick("Todo", "Milch", false);
    onlineAfterMidnight();

    await vi.waitFor(() => expect(store.snapshot().queue).toEqual([]));
    expect(share.posts.map((post) => post.path)).toEqual(["/share/lists/Todo/tick"]);
    expect(share.items("Todo")[0]?.done).toBe(false);
    expect(share.items("Einkauf")[0]?.done).toBe(true);
    store.close();
  });

  it("requestFor sends a tick's own day over the send-time one, and no day on the other writes", () => {
    const item = {
      line: 3,
      depth: 0,
      text: "Milch",
      done: false,
      assignee: null,
      ticked_by: null,
      ticked_at: null,
    };
    const list: ListData = { name: "Einkauf", sha: "s", items: [item] };
    const tick = {
      id: "1",
      kind: "tick",
      list: "Einkauf",
      text: "Milch",
      done: true,
      day: "2026-11-03",
    } as const;
    const assign = {
      id: "2",
      kind: "assign",
      list: "Einkauf",
      text: "Milch",
      assignee: "Anna",
      from: null,
    } as const;
    const clear = { id: "3", kind: "clear", list: "Einkauf" } as const;

    expect(requestFor(tick, list, "2026-11-04")?.body).toMatchObject({ day: "2026-11-03" });
    expect(requestFor(assign, list, "2026-11-04")?.body).not.toHaveProperty("day");
    expect(requestFor(clear, list, "2026-11-04")?.body).not.toHaveProperty("day");
  });
});
