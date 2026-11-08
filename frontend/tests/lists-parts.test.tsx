import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ListsApp } from "@/lists/lists-app";
import { fakeShare, type Seed } from "./lists-fixture";

/** Stub `/share` with the seed and draw the app. */
function open(seed: Record<string, Seed[]>) {
  const share = fakeShare(seed);
  vi.stubGlobal("fetch", share.fetch);
  return { share, ...render(<ListsApp />) };
}

const HOUSE: Seed[] = [
  { text: "Haus finanzieren", done: false },
  { text: "Bank anrufen", done: false, depth: 1 },
  { text: "Notar", done: true, depth: 1 },
  { text: "Brot", done: false },
];

/** The words of every row's checkbox, in screen order. */
const boxes = () =>
  screen.getAllByRole("checkbox").map((box) => box.getAttribute("aria-label") ?? "");

/** Opens an item's words for editing and answers the field. */
function editOf(words: string): HTMLInputElement {
  fireEvent.click(screen.getByRole("button", { name: `${words} bearbeiten` }));
  return screen.getByRole("textbox", { name: "Wörter" }) as HTMLInputElement;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parts in the lists app", () => {
  it("#1666 draws parts under their item, one step in, with the count after the words", async () => {
    open({ Einkauf: [], Todo: HOUSE });
    fireEvent.click(await screen.findByRole("button", { name: /^Todo/ }));
    await screen.findByRole("checkbox", { name: "Bank anrufen" });

    expect(boxes()).toEqual(["Haus finanzieren", "Bank anrufen", "Notar", "Brot"]);
    const part = screen.getByRole("checkbox", { name: "Notar" }).closest(".row") as HTMLElement;
    expect(part.style.getPropertyValue("--depth")).toBe("1");
    expect(screen.getByRole("button", { name: "Haus finanzieren bearbeiten" }).textContent).toBe(
      "Haus finanzieren1/2",
    );
    // The switch counts items, not their parts.
    expect(screen.getByRole("button", { name: "Todo 2" })).toBeTruthy();
  });

  it("#1666 a tick on an item ticks its open parts with it, and the fold hides them", async () => {
    const { share } = open({ Einkauf: [], Todo: HOUSE });
    fireEvent.click(await screen.findByRole("button", { name: /^Todo/ }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Haus finanzieren" }));

    await waitFor(() =>
      expect(share.items("Todo").map((item) => item.done)).toEqual([true, true, true, false]),
    );
    expect(
      screen.getByRole("checkbox", { name: "Bank anrufen" }).getAttribute("aria-checked"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Teile von Haus finanzieren" }));
    expect(screen.queryByRole("checkbox", { name: "Bank anrufen" })).toBeNull();
  });

  it("#1666 the + on an item turns the Eintrag field into one for a part of it", async () => {
    const { share } = open({ Einkauf: [], Todo: HOUSE });
    fireEvent.click(await screen.findByRole("button", { name: /^Todo/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Teil zu Haus finanzieren" }));
    expect(screen.getByText("Teil von „Haus finanzieren“")).toBeTruthy();

    const field = screen.getByRole("textbox", { name: "Eintrag" });
    fireEvent.change(field, { target: { value: "Kredit prüfen" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() =>
      expect(share.items("Todo")[3]).toEqual({ text: "Kredit prüfen", done: false, depth: 1 }),
    );
    expect(share.posts.at(-1)?.body.under).toBe(0);
  });
});

describe("editing and deleting in the lists app", () => {
  it("#1666 a tap on the words edits them in place, and Enter saves", async () => {
    const { share } = open({ Einkauf: [{ text: "Milch", done: false }], Todo: [] });
    await screen.findByRole("checkbox", { name: "Milch" });

    const field = editOf("Milch");
    fireEvent.change(field, { target: { value: "2x Milch" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => expect(share.items("Einkauf")[0]?.text).toBe("2x Milch"));
    expect(share.posts.at(-1)?.body).toMatchObject({ line: 0, text: "2x Milch" });
  });

  it("#1666 Escape keeps the words, and empty words save nothing", async () => {
    const { share } = open({ Einkauf: [{ text: "Milch", done: false }], Todo: [] });
    await screen.findByRole("checkbox", { name: "Milch" });

    const escaped = editOf("Milch");
    fireEvent.change(escaped, { target: { value: "Brot" } });
    fireEvent.keyDown(escaped, { key: "Escape" });
    const emptied = editOf("Milch");
    fireEvent.change(emptied, { target: { value: "  " } });
    fireEvent.blur(emptied);

    expect(screen.getByRole("checkbox", { name: "Milch" })).toBeTruthy();
    expect(share.posts).toEqual([]);
  });

  it("#1666 Löschen hides the item at once, and Rückgängig brings it back with nothing sent", async () => {
    const { share } = open({ Einkauf: [{ text: "Milch", done: false }], Todo: [] });
    await screen.findByRole("checkbox", { name: "Milch" });

    editOf("Milch");
    fireEvent.click(screen.getByRole("button", { name: "Löschen" }));
    expect(screen.queryByRole("checkbox", { name: "Milch" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Rückgängig" }));

    expect(screen.getByRole("checkbox", { name: "Milch" })).toBeTruthy();
    expect(share.posts).toEqual([]);
  });

  it("#1666 a delete still waiting is queued, not dropped, when the screen goes", async () => {
    const { unmount } = open({ Einkauf: HOUSE, Todo: [] });
    await screen.findByRole("checkbox", { name: "Bank anrufen" });

    editOf("Haus finanzieren");
    fireEvent.click(screen.getByRole("button", { name: "Löschen" }));
    // The item goes with its parts.
    expect(boxes()).toEqual(["Brot"]);
    unmount();

    const queue = JSON.parse(localStorage.getItem("kasten.lists.queue") ?? "[]") as object[];
    expect(queue).toContainEqual(
      expect.objectContaining({ kind: "delete", list: "Einkauf", text: "Haus finanzieren" }),
    );
  });
});
