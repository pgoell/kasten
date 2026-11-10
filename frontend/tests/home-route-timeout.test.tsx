import { hashed } from "./digests";
import { FakeEventSource, pageHooks, renderApp, settle, theRoute } from "./home-route-fixture";

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
  deleteImage: vi.fn(),
  fetchTrash: vi.fn(),
  restoreEntry: vi.fn(),
  deleteNote: vi.fn(),
  renameNote: vi.fn(),
  moveFolder: vi.fn(),
  fetchHistory: vi.fn(),
  fetchHistoryText: vi.fn(),
}));

vi.mock("@/lib/core/api", () => ({
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
  fetchWeather: async () => [],
  UPLOAD_LIMIT_BYTES: 1024 * 1024 * 1024,
  ChangedOnDisk: class ChangedOnDisk extends Error {},
  NoteExists: class NoteExists extends Error {},
  NoteMissing: class NoteMissing extends Error {},
}));
vi.mock("@/lib/vault/move/move-api", () => ({ renameNote, moveFolder }));
vi.mock("@/lib/vault/move/trash-api", () => ({
  deleteNote,
  fetchTrash,
  restoreEntry,
  deleteImage,
}));
vi.mock("@/lib/history/history-api", () => ({ fetchHistory, fetchHistoryText }));
vi.mock("foliate-js/view.js", () => ({}));
vi.mock("@/lib/capture/outbox", () => ({
  keep: vi.fn(),
  flush: vi.fn(),
  start: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));

pageHooks();

// First in the file, so its first test is the one that meets what the warm-up left.
describe("the page around a test that timed out (#1337)", () => {
  theRoute();

  it("the warm-up mount leaves no page, no stored layout and no calls for the first test", () => {
    expect(document.body.innerHTML).toBe("");
    expect(localStorage.getItem("kasten.workspace.1")).toBeNull();
    expect(localStorage.getItem("kasten.positions.1")).toBeNull();
    expect(FakeEventSource.last).toBeUndefined();
    expect(fetchFiles).not.toHaveBeenCalled();
    expect(fetchNote).not.toHaveBeenCalled();
    expect(fetchTodos).not.toHaveBeenCalled();
  });

  // A body that runs out of time goes on running: vitest fails it but cannot
  // stop it. Held here until the next test lets it go, the way a loaded box
  // holds one past its timeout and into the test after it.
  let wake: () => void = () => {};
  const woken = new Promise<void>((resolve) => {
    wake = resolve;
  });

  it.fails("a test held past its timeout fails by the timeout", { timeout: 1000 }, async () => {
    const app = await renderApp();
    await settle();
    await woken;
    await hashed();
    await settle();
    app.click("index.md");
    await settle();
  });

  it("the test after one that timed out mounts the route and opens a note", async () => {
    // The orphan above wakes inside this test and reaches for `act` beside it.
    wake();
    await settle();
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();

    expect(app.text()).toBe("the index note");
  });
});
