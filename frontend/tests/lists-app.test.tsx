import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ListsApp } from "@/lists/lists-app";
import { fakeShare, type Seed, setOnline } from "./lists-fixture";

/** Stub `/share` with the seed and draw the app. */
function open(seed: Record<string, Seed[]>) {
  const share = fakeShare(seed);
  vi.stubGlobal("fetch", share.fetch);
  render(<ListsApp />);
  return share;
}

const input = () => screen.getByRole("textbox", { name: "Neuer Eintrag" });

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "onLine");
});

describe("the lists app", () => {
  it("offers an item that was on the list before, by its first letters, and not one that is open now", async () => {
    open({
      Einkauf: [
        { text: "Milch", done: true },
        { text: "Mineralwasser", done: false },
      ],
      Todo: [],
    });
    await screen.findByRole("checkbox", { name: "Mineralwasser" });

    fireEvent.change(input(), { target: { value: "Mi" } });

    const chips = screen.getByLabelText("Vorschläge");
    expect(
      within(chips)
        .getAllByRole("button")
        .map((chip) => chip.textContent),
    ).toEqual(["Milch"]);
  });

  it("Enter adds the item and keeps focus in the input", async () => {
    const share = open({ Einkauf: [], Todo: [] });
    await screen.findByText("Nichts auf der Liste");

    input().focus();
    fireEvent.change(input(), { target: { value: "Brot" } });
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(await screen.findByRole("checkbox", { name: "Brot" })).toBeInTheDocument();
    expect(input()).toHaveValue("");
    expect(input()).toHaveFocus();
    expect(share.posts).toHaveLength(1);
  });

  it("blank Enter adds nothing", async () => {
    const share = open({ Einkauf: [], Todo: [] });
    await screen.findByText("Nichts auf der Liste");

    fireEvent.change(input(), { target: { value: "   " } });
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(share.posts).toEqual([]);
  });

  it("tapping a row ticks it and it moves to the done group", async () => {
    open({ Einkauf: [{ text: "Brot", done: false }], Todo: [] });

    fireEvent.click(await screen.findByRole("checkbox", { name: "Brot" }));

    const done = await screen.findByRole("region", { name: "Erledigt" });
    expect(within(done).getByRole("checkbox", { name: "Brot" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("Leeren empties the done group", async () => {
    open({
      Einkauf: [
        { text: "Brot", done: true },
        { text: "Eier", done: false },
      ],
      Todo: [],
    });

    fireEvent.click(await screen.findByRole("button", { name: "Leeren" }));

    await waitFor(() => expect(screen.queryByRole("region", { name: "Erledigt" })).toBeNull());
    expect(screen.getByRole("checkbox", { name: "Eier" })).toBeInTheDocument();
  });

  it("the screen shows item text with no `- [ ]`, no `✅` and no `🆔`", async () => {
    open({
      Einkauf: [
        { text: "Milch", done: false },
        { text: "Brot", done: true },
      ],
      Todo: [],
    });
    await screen.findByRole("checkbox", { name: "Milch" });

    const text = document.body.textContent ?? "";
    expect(text).toContain("Milch");
    expect(text).not.toContain("- [ ]");
    expect(text).not.toContain("✅");
    expect(text).not.toContain("🆔");
  });

  it("the empty state says the list has nothing on it", async () => {
    open({ Einkauf: [], Todo: [] });

    expect(await screen.findByText("Nichts auf der Liste")).toBeInTheDocument();
  });

  it("shows the offline pill while navigator.onLine is false", async () => {
    setOnline(false);
    open({ Einkauf: [], Todo: [] });

    expect(await screen.findByText("Offline, wird gesendet")).toBeInTheDocument();
  });
});
