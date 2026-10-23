import { fireEvent, screen, within } from "@testing-library/react";
import { pageHooks, renderApp, settle, theRoute } from "./home-route-fixture";

// The doubles, the same in every home-route file: see home-route-fixture.tsx.
const {
  fetchFiles,
  fetchNote,
  saveNote,
  updateNote,
  searchNotes,
  fetchMentions,
  createNote,
  fetchTerminals,
  fetchTodos,
  fetchBook,
  uploadAsset,
  fetchImages,
  fetchHtml,
  fetchAssets,
  fetchVersion,
  fetchTags,
  fetchCards,
  fetchReviewLimits,
  deleteImage,
  fetchTrash,
  restoreEntry,
  deleteNote,
  renameNote,
  moveFolder,
  fetchHistory,
  fetchHistoryText,
} = vi.hoisted(() => ({
  fetchFiles: vi.fn(),
  fetchNote: vi.fn(),
  saveNote: vi.fn(),
  updateNote: vi.fn(),
  searchNotes: vi.fn(),
  fetchMentions: vi.fn(),
  createNote: vi.fn(),
  fetchTerminals: vi.fn().mockResolvedValue([]),
  fetchTodos: vi.fn().mockResolvedValue([]),
  fetchBook: vi.fn(),
  uploadAsset: vi.fn().mockResolvedValue(undefined),
  fetchImages: vi.fn().mockResolvedValue([]),
  fetchHtml: vi.fn().mockResolvedValue([]),
  fetchAssets: vi.fn().mockResolvedValue([]),
  fetchVersion: vi.fn().mockResolvedValue("0.8.0"),
  fetchTags: vi.fn().mockResolvedValue([]),
  fetchCards: vi.fn(),
  fetchReviewLimits: vi.fn(),
  deleteImage: vi.fn(),
  fetchTrash: vi.fn(),
  restoreEntry: vi.fn(),
  deleteNote: vi.fn(),
  renameNote: vi.fn(),
  moveFolder: vi.fn(),
  fetchHistory: vi.fn(),
  fetchHistoryText: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  fetchFiles,
  fetchNote,
  saveNote,
  updateNote,
  searchNotes,
  fetchMentions,
  createNote,
  fetchTerminals,
  fetchTodos,
  fetchBook,
  uploadAsset,
  fetchImages,
  fetchHtml,
  fetchAssets,
  fetchVersion,
  fetchTags,
  fetchCards,
  fetchReviewLimits,
  fetchWeather: async () => [],
  UPLOAD_LIMIT_BYTES: 1024 * 1024 * 1024,
  ChangedOnDisk: class ChangedOnDisk extends Error {},
  NoteExists: class NoteExists extends Error {},
  NoteMissing: class NoteMissing extends Error {},
}));
vi.mock("@/lib/move-api", () => ({ renameNote, moveFolder }));
vi.mock("@/lib/trash-api", () => ({ deleteNote, fetchTrash, restoreEntry, deleteImage }));
vi.mock("@/lib/history-api", () => ({ fetchHistory, fetchHistoryText }));
vi.mock("foliate-js/view.js", () => ({}));
// jsdom has no canvas to draw the graph on, so the pane gets a canvas that draws nothing.
vi.mock("@/lib/graph-canvas", () => ({
  drawGraph: () => ({ update() {}, resize() {}, fit() {}, cluster() {}, destroy() {} }),
}));
vi.mock("@/lib/outbox", () => ({
  keep: vi.fn(),
  flush: vi.fn(),
  start: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));

pageHooks();

describe("the top bar", () => {
  theRoute();

  beforeEach(() => {
    vi.mocked(fetchCards).mockResolvedValue([]);
    vi.mocked(fetchReviewLimits).mockResolvedValue({ new_per_day: null, reviews_per_day: null });
    vi.mocked(searchNotes).mockResolvedValue([]);
  });

  /** The bar, which a missing one fails on by name rather than by a null. */
  function bar(): HTMLElement {
    const found = document.querySelector<HTMLElement>("[data-top-bar]");
    expect(found).not.toBeNull();
    return found as HTMLElement;
  }

  it("the top bar is 56 px tall in its class and holds the wordmark, Vault, Graph, Search, the field and New note", async () => {
    await renderApp();
    await settle();

    const top = bar();
    expect(top.classList.contains("h-14")).toBe(true);
    expect(top.classList.contains("sticky")).toBe(true);
    expect(top.classList.contains("top-0")).toBe(true);
    expect(within(top).getByText("kasten")).toBeTruthy();
    expect(within(top).getByRole("navigation", { name: "Main" })).toBeTruthy();
    for (const name of ["Vault", "Graph", "Search", "New note"]) {
      expect(within(top).getByRole("button", { name })).toBeTruthy();
    }
    expect(within(top).getByRole("button", { name: "Search 2 notes" })).toBeTruthy();
  });

  it("the search field says how many notes it covers", async () => {
    vi.mocked(fetchFiles).mockResolvedValue(["index.md", "other.md", "third.md"]);
    await renderApp();
    await settle();

    expect(within(bar()).getByRole("button", { name: "Search 3 notes" })).toBeTruthy();
  });

  it("Graph in the top bar opens the vault graph", async () => {
    await renderApp();
    await settle();

    fireEvent.click(within(bar()).getByRole("button", { name: "Graph" }));
    await settle();

    expect(document.querySelector("[data-graph-pane]")).not.toBeNull();
  });

  it("New note in the top bar opens the new note prompt", async () => {
    await renderApp();
    await settle();

    fireEvent.click(within(bar()).getByRole("button", { name: "New note" }));
    await settle();

    expect(screen.queryByRole("dialog", { name: "New note" })).not.toBeNull();
  });
});
