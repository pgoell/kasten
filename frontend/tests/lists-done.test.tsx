import { fireEvent, render, screen, within } from "@testing-library/react";
import { ListsApp } from "@/lists/lists-app";
import { fakeShare, type Seed } from "./lists-fixture";

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
    .map((box) => box.textContent);

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
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
