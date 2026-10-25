import { fireEvent, render, screen, within } from "@testing-library/react";
import { ListsApp } from "@/lists/lists-app";
import { createListsStore } from "@/lists/lists-store";
import { fakeShare, type Seed, setOnline } from "./lists-fixture";

/** Stub `/share` with the seed and draw the app. */
function open(seed: Record<string, Seed[]>) {
  const share = fakeShare(seed);
  vi.stubGlobal("fetch", share.fetch);
  render(<ListsApp />);
  return share;
}

/** The row an item sits in, found by the words its checkbox is named by. */
const rowOf = (words: string) =>
  screen.getByRole("checkbox", { name: words }).closest(".row") as HTMLElement;

/** The chip of an item's row. */
function chipOf(words: string): HTMLElement {
  const chip = rowOf(words).querySelector<HTMLElement>(".chip");
  if (!chip) throw new Error(`no assignee chip in the row ${words}`);
  return chip;
}

const menu = () => screen.getByRole("menu");

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "onLine");
});

describe("the assignee chip in the lists app", () => {
  it("#810 A4 each item is one checkbox named by its words, with its chip beside it and no button inside a button", async () => {
    open({ Einkauf: [{ text: "Milch", done: false, assignee: "[[Pascal]]" }], Todo: [] });
    const box = await screen.findByRole("checkbox", { name: "Milch" });

    expect(box.querySelector("button")).toBeNull();
    expect(box.contains(chipOf("Milch"))).toBe(false);
    expect(chipOf("Milch").textContent).toBe("Ich");
  });

  it("#810 A5 an item with nobody shows Wer?, one for you Ich, and one for Alicia her name", async () => {
    open({
      Einkauf: [
        { text: "Milch", done: false },
        { text: "Brot", done: false, assignee: "[[Pascal]]" },
        { text: "Eier", done: false, assignee: "[[Alicia]]" },
      ],
      Todo: [],
    });
    await screen.findByRole("checkbox", { name: "Milch" });

    expect(chipOf("Milch").textContent).toBe("Wer?");
    expect(chipOf("Brot").textContent).toBe("Ich");
    expect(chipOf("Eier").textContent).toBe("Alicia");
  });

  it("#810 A5 a link whose path or alias names you reads as Ich", async () => {
    open({
      Einkauf: [
        { text: "Milch", done: false, assignee: "[[03 Areas/08 People/Pascal|P]]" },
        { text: "Brot", done: false, assignee: "[[03 Areas/08 People/Alicia]]" },
      ],
      Todo: [],
    });
    await screen.findByRole("checkbox", { name: "Milch" });

    expect(chipOf("Milch").textContent).toBe("Ich");
    expect(chipOf("Brot").textContent).toBe("Alicia");
  });

  it("#810 A5 tapping the chip opens a menu of the people then Niemand, with the chosen one checked", async () => {
    open({ Einkauf: [{ text: "Milch", done: false, assignee: "[[Alicia]]" }], Todo: [] });
    fireEvent.click(await screen.findByRole("button", { name: "Alicia" }));

    const options = within(menu()).getAllByRole("menuitemradio");
    expect(options.map((option) => option.textContent)).toEqual(["Pascal", "Alicia", "Niemand"]);
    expect(within(menu()).getByRole("menuitemradio", { name: "Alicia" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("#810 A5 a pick sends the assign, shows the name at once and closes the menu", async () => {
    const share = open({ Einkauf: [{ text: "Milch", done: false }], Todo: [] });
    fireEvent.click(await screen.findByRole("button", { name: "Wer?" }));
    fireEvent.click(within(menu()).getByRole("menuitemradio", { name: "Pascal" }));

    expect(chipOf("Milch").textContent).toBe("Ich");
    expect(screen.queryByRole("menu")).toBeNull();
    // The write goes up after the store reads the list, so it is awaited.
    await vi.waitFor(() =>
      expect(share.posts).toEqual([
        { path: "/share/lists/Einkauf/assign", body: { line: 0, assignee: "Pascal", sha: "1" } },
      ]),
    );
  });

  it("#810 A5 Niemand sends the assign with no person and shows Wer?", async () => {
    const share = open({
      Einkauf: [{ text: "Milch", done: false, assignee: "[[Alicia]]" }],
      Todo: [],
    });
    fireEvent.click(await screen.findByRole("button", { name: "Alicia" }));
    fireEvent.click(within(menu()).getByRole("menuitemradio", { name: "Niemand" }));

    expect(chipOf("Milch").textContent).toBe("Wer?");
    await vi.waitFor(() =>
      expect(share.items("Einkauf")[0]).toEqual({
        text: "Milch",
        done: false,
        assignee: null,
      }),
    );
    expect(share.posts.at(-1)?.body).toEqual({ line: 0, assignee: null, sha: "1" });
  });

  it("#810 A5 with no name read the menu offers only Niemand", async () => {
    const share = fakeShare({
      Einkauf: [{ text: "Milch", done: false, assignee: "[[Pascal]]" }],
      Todo: [],
    });
    const answer = share.fetch;
    // The `/share/me` read fails; every other request is the fake's.
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
      url === "/share/me"
        ? Promise.resolve(new Response("{}", { status: 500 }))
        : answer(url, init),
    );
    render(<ListsApp />);

    fireEvent.click(await screen.findByRole("button", { name: "Pascal" }));
    expect(
      within(menu())
        .getAllByRole("menuitemradio")
        .map((option) => option.textContent),
    ).toEqual(["Niemand"]);
  });

  it("#810 A3 each list switch shows its open count and a queued tick moves it at once", async () => {
    open({
      Einkauf: [
        { text: "Milch", done: false },
        { text: "Brot", done: false },
        { text: "Eier", done: false },
      ],
      Todo: [{ text: "Steuer", done: false }],
    });

    expect(await screen.findByRole("button", { name: "Einkauf 3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Todo 1" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Milch" }));
    expect(screen.getByRole("button", { name: "Einkauf 2" })).toBeInTheDocument();
  });

  it("#810 A6 Meine shows the items for you and the ones for nobody, and Alle shows all", async () => {
    open({
      Einkauf: [
        { text: "Milch", done: false, assignee: "[[Pascal]]" },
        { text: "Vollkornbrot", done: false, assignee: "[[Alicia]]" },
        { text: "Eier", done: false },
      ],
      Todo: [],
    });
    await screen.findByRole("checkbox", { name: "Milch" });

    fireEvent.click(screen.getByRole("button", { name: "Meine" }));
    expect(screen.getAllByRole("checkbox").map((box) => box.textContent)).toEqual([
      "Milch",
      "Eier",
    ]);
    // The counts stay the counts of every open item.
    expect(screen.getByRole("button", { name: "Einkauf 3" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Alle" }));
    expect(screen.getAllByRole("checkbox").map((box) => box.textContent)).toEqual([
      "Milch",
      "Vollkornbrot",
      "Eier",
    ]);
  });

  it("#810 I2 an assign answered 409 is read again and sent on the item it finds by its text", async () => {
    const share = open({
      Einkauf: [
        { text: "Milch", done: false },
        { text: "Brot", done: false },
      ],
      Todo: [],
    });
    await screen.findByRole("checkbox", { name: "Brot" });

    // Another writer puts Eier above both, so Brot moves from line 1 to line 2.
    share.beforeWrite(() => share.external("Einkauf", "Eier"));
    fireEvent.click(chipOf("Brot"));
    fireEvent.click(within(menu()).getByRole("menuitemradio", { name: "Alicia" }));

    await vi.waitFor(() =>
      expect(share.items("Einkauf").find((item) => item.text === "Brot")).toEqual({
        text: "Brot",
        done: false,
        assignee: "[[Alicia]]",
      }),
    );
    expect(share.posts.at(-1)?.body).toEqual({ line: 2, assignee: "Alicia", sha: "2" });
    expect(share.items("Einkauf").find((item) => item.text === "Eier")?.assignee).toBeUndefined();
  });

  it("#810 I2 an assign to the person the line already names writes nothing", async () => {
    const share = open({
      Einkauf: [{ text: "Milch", done: false, assignee: "[[Alicia]]" }],
      Todo: [],
    });
    fireEvent.click(await screen.findByRole("button", { name: "Alicia" }));
    fireEvent.click(within(menu()).getByRole("menuitemradio", { name: "Alicia" }));

    await vi.waitFor(() => expect(localStorage.getItem("kasten.lists.queue")).toBe("[]"));
    expect(share.posts).toEqual([]);
  });

  it("#810 I3 an assign to a name outside the people is refused and the server's words are shown", async () => {
    const share = fakeShare({ Einkauf: [{ text: "Milch", done: false }], Todo: [] });
    vi.stubGlobal("fetch", share.fetch);
    const store = createListsStore();
    await vi.waitFor(() => expect(store.snapshot().lists.Einkauf).toBeDefined());

    // The line showed nobody when picked, so the pick names `null` as `from`.
    store.assign("Einkauf", "Milch", "Nobody", null);

    await vi.waitFor(() => expect(store.snapshot().errors).toEqual(["Unbekannte Person"]));
    expect(store.snapshot().queue).toEqual([]);
    expect(share.items("Einkauf")).toEqual([{ text: "Milch", done: false }]);
    store.close();
  });

  it("#810 I6 an assign made offline shows at once, waits across a reload and goes up when back online", async () => {
    const share = fakeShare({ Einkauf: [{ text: "Milch", done: false }], Todo: [] });
    vi.stubGlobal("fetch", share.fetch);
    setOnline(false);
    const first = render(<ListsApp />);
    fireEvent.click(await screen.findByRole("button", { name: "Wer?" }));
    fireEvent.click(within(menu()).getByRole("menuitemradio", { name: "Alicia" }));
    expect(chipOf("Milch").textContent).toBe("Alicia");
    first.unmount();

    // A reload: the pick is still there, drawn over the list, and nothing has gone up.
    render(<ListsApp />);
    expect(await screen.findByRole("button", { name: "Alicia" })).toBeInTheDocument();
    expect(share.posts).toEqual([]);

    setOnline(true);
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(share.items("Einkauf")[0]?.assignee).toBe("[[Alicia]]"));
    expect(share.posts).toHaveLength(1);
  });

  it("#810 I7 by keys Enter opens the menu, the arrows move through it, and Enter picks and gives the focus back to the chip", async () => {
    const share = open({ Einkauf: [{ text: "Milch", done: false }], Todo: [] });
    const chip = await screen.findByRole("button", { name: "Wer?" });

    chip.focus();
    // Enter on a focused button is a click; jsdom does not turn the key into one.
    fireEvent.click(chip);
    expect(screen.getByRole("menuitemradio", { name: "Niemand" })).toHaveFocus();

    fireEvent.keyDown(menu(), { key: "ArrowDown" });
    expect(screen.getByRole("menuitemradio", { name: "Pascal" })).toHaveFocus();
    fireEvent.keyDown(menu(), { key: "ArrowDown" });
    expect(screen.getByRole("menuitemradio", { name: "Alicia" })).toHaveFocus();

    fireEvent.click(screen.getByRole("menuitemradio", { name: "Alicia" }));
    expect(chip).toHaveFocus();
    await vi.waitFor(() => expect(share.posts).toHaveLength(1));
  });

  it("#810 I7 Escape closes the menu and puts the focus back on the chip", async () => {
    open({ Einkauf: [{ text: "Milch", done: false }], Todo: [] });
    const chip = await screen.findByRole("button", { name: "Wer?" });

    fireEvent.click(chip);
    fireEvent.keyDown(menu(), { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(chip).toHaveFocus();
    expect(chip).toHaveAttribute("aria-expanded", "false");
  });

  it("#810 I7 a press outside closes the menu, and a second chip's menu replaces the first", async () => {
    open({
      Einkauf: [
        { text: "Milch", done: false },
        { text: "Brot", done: false },
      ],
      Todo: [],
    });
    await screen.findByRole("checkbox", { name: "Milch" });
    fireEvent.click(chipOf("Milch"));
    fireEvent.click(chipOf("Brot"));
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    expect(chipOf("Brot")).toHaveAttribute("aria-expanded", "true");

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("#810 L4 a tap opens the menu without moving the focus into it, a key opens it with the checked item focused", async () => {
    open({ Einkauf: [{ text: "Milch", done: false, assignee: "[[Alicia]]" }], Todo: [] });
    const chip = await screen.findByRole("button", { name: "Alicia" });

    chip.focus();
    // A tap or a mouse click has a detail of 1 or more; a key's click has 0.
    fireEvent.click(chip, { detail: 1 });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(chip).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    fireEvent.click(chip, { detail: 0 });
    expect(screen.getByRole("menuitemradio", { name: "Alicia" })).toHaveFocus();
  });
});
