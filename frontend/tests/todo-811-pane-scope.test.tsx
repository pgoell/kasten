import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { boardHooks, boardPane } from "./todo-board-pane-fixture";
import { paneHooks, renderPane } from "./todo-pane-fixture";

// The doubles, the same in every todo-pane file: see todo-pane-fixture.tsx.
const { fetchTodos, fetchNote, fetchFiles, createNote } = vi.hoisted(() => ({
  fetchTodos: vi.fn(),
  fetchNote: vi.fn(),
  fetchFiles: vi.fn(),
  createNote: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ fetchTodos, fetchNote, fetchFiles, createNote }));

paneHooks();
boardHooks();

/** A hit as the backend answers it, with the shared flag the backend adds (#811). */
type Hit = { path: string; line: number; text: string; shared?: boolean };

const KINDS: Hit[] = [
  { path: "a.md", line: 1, text: "- [ ] send the invoice #client 📅 2026-08-10" },
  { path: "a.md", line: 2, text: "- [ ] fix the tap #private 📅 2026-08-10" },
  { path: "a.md", line: 3, text: "- [ ] tidy the notes 📅 2026-08-10" },
];

const PARTS: Hit[] = [
  { path: "a.md", line: 1, text: "- [ ] write the deck 📅 2026-08-12 #internal" },
  { path: "a.md", line: 2, text: "  - [ ] draw the chart" },
  { path: "a.md", line: 3, text: "- [ ] send the invoice #client 📅 2026-08-10" },
];

/** A shared list's todo and two of the kinds, so the chip, the toggle and the filter each have a row to narrow. */
const CLIENTS: Hit[] = [
  {
    path: "05 Shared/Einkauf.md",
    line: 1,
    text: "- [ ] send the offer #client 📅 2026-08-10",
    shared: true,
  },
  { path: "a.md", line: 2, text: "- [ ] call the client #client 📅 2026-08-10" },
  { path: "a.md", line: 3, text: "- [ ] fix the tap #internal 📅 2026-08-10" },
];

/** Two open todos, and one shared list's todo that is hidden by default. */
const SHARED: Hit[] = [
  { path: "a.md", line: 1, text: "- [ ] call the client #client 📅 2026-08-10" },
  { path: "a.md", line: 2, text: "- [ ] fix the tap #internal 📅 2026-08-10" },
  { path: "05 Shared/Einkauf.md", line: 1, text: "- [ ] buy eggs 📅 2026-08-14", shared: true },
];

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("the todo pane's scope", () => {
  it("#811 A5 the kind chips narrow the list", async () => {
    const pane = renderPane(KINDS);
    await waitFor(() => expect(pane.texts().join()).toContain("send the invoice"));

    fireEvent.click(screen.getByRole("button", { name: "#client" }));
    expect(pane.texts().join()).toContain("send the invoice");
    expect(pane.texts().join()).not.toContain("fix the tap");
    expect(pane.texts().join()).not.toContain("tidy the notes");

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(pane.texts().join()).toContain("tidy the notes");
  });

  it("#811 A5 the kind chips narrow the board", async () => {
    await boardPane();
    // Pressed is false only on the chip: a lane's heading names the same kind but has no pressed state.
    fireEvent.click(screen.getByRole("button", { name: "#client", pressed: false }));

    const cards = screen.queryAllByTestId("todo-card").map((card) => card.textContent ?? "");
    expect(cards.join()).toContain("send the invoice");
    expect(cards.join()).not.toContain("write the deck");
    expect(cards.join()).not.toContain("fix the tap");
  });

  it("#811 A5 a part of an internal todo is internal in the filter", async () => {
    const pane = renderPane(PARTS);
    await waitFor(() => expect(pane.texts().join()).toContain("write the deck"));

    fireEvent.click(screen.getByRole("button", { name: "#internal" }));
    expect(pane.texts().join()).toContain("draw the chart");
    expect(pane.texts().join()).not.toContain("send the invoice");
  });

  it("#811 I4 the chip, the toggle and the typed filter all hold at once", async () => {
    const pane = renderPane(CLIENTS);
    await waitFor(() => expect(pane.texts().join()).toContain("call the client"));

    fireEvent.click(screen.getByRole("button", { name: "#client" }));
    expect(pane.texts().join()).toContain("call the client");
    expect(pane.texts().join()).not.toContain("fix the tap");
    expect(pane.texts().join()).not.toContain("send the offer");

    fireEvent.click(screen.getByRole("button", { name: "Shared lists, 1 hidden" }));
    expect(pane.texts().join()).toContain("send the offer");

    pane.type("offer");
    expect(pane.texts().join()).toContain("send the offer");
    expect(pane.texts().join()).not.toContain("call the client");

    fireEvent.click(screen.getByRole("button", { name: "Shared lists, shown" }));
    expect(screen.getByRole("button", { name: "Shared lists, 1 hidden" })).toBeTruthy();
    expect(pane.texts().join()).not.toContain("send the offer");
  });

  it("#811 A10 shared lists are hidden by default and the toggle says how many", async () => {
    const pane = renderPane(SHARED);
    await waitFor(() => expect(pane.texts().join()).toContain("call the client"));

    expect(pane.texts().join()).not.toContain("buy eggs");
    const toggle = screen.getByRole("button", { name: "Shared lists, 1 hidden" });
    expect(toggle.textContent).toBe("Shared lists, 1 hidden");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
  });

  it("#811 A10 the toggle shows them and is kept under kasten.todos.shared", async () => {
    const pane = renderPane(SHARED);
    await waitFor(() => expect(pane.texts().join()).toContain("call the client"));

    fireEvent.click(screen.getByRole("button", { name: "Shared lists, 1 hidden" }));
    expect(pane.texts().join()).toContain("buy eggs");
    expect(screen.getByRole("button", { name: "Shared lists, shown" })).toBeTruthy();
    expect(localStorage.getItem("kasten.todos.shared")).toBe("1");

    // A reload reads the stored choice back, so the lists stay shown.
    cleanup();
    const again = renderPane(SHARED);
    await waitFor(() => expect(again.texts().join()).toContain("buy eggs"));

    fireEvent.click(screen.getByRole("button", { name: "Shared lists, shown" }));
    expect(localStorage.getItem("kasten.todos.shared")).toBe(null);
    expect(again.texts().join()).not.toContain("buy eggs");
  });

  it("#811 I7 a storage that throws keeps shared lists hidden and the toggle works", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("site data is blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("site data is blocked", "SecurityError");
    });

    const pane = renderPane(SHARED);
    await waitFor(() => expect(pane.texts().join()).toContain("call the client"));
    expect(pane.texts().join()).not.toContain("buy eggs");

    fireEvent.click(screen.getByRole("button", { name: "Shared lists, 1 hidden" }));
    expect(pane.texts().join()).toContain("buy eggs");

    fireEvent.click(screen.getByRole("button", { name: "Shared lists, shown" }));
    expect(pane.texts().join()).not.toContain("buy eggs");
  });
});
