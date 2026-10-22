import type { SearchHit, TodoHit } from "@/lib/api";
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
vi.mock("@/lib/outbox", () => ({
  keep: vi.fn(),
  flush: vi.fn(),
  start: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));

pageHooks();

/** Today is the 22nd of October 2026, a Thursday, so the dates below read as today, last month and overdue. */
const TODAY = new Date(2026, 9, 22, 9, 0);

function todo(line: number, text: string): TodoHit {
  return { path: "index.md", line, text, project: null };
}

function stamped(path: string, line: number, stamp: string): SearchHit {
  return { path, line, text: `modified: ${stamp}` };
}

/** The three columns of the home screen, in the order they are drawn: Today, Recent, Due. */
function columns(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-today-column]")];
}

/** The text of each row a column draws, in order. */
function rowsOf(column: HTMLElement | undefined): (string | null)[] {
  return [...(column?.querySelectorAll("button") ?? [])].map((row) => row.textContent);
}

describe("the home screen", () => {
  theRoute();

  beforeEach(() => {
    vi.mocked(fetchCards).mockResolvedValue([]);
    vi.mocked(fetchReviewLimits).mockResolvedValue({ new_per_day: null, reviews_per_day: null });
    vi.mocked(searchNotes).mockResolvedValue([]);
  });

  it("Today heads an empty pane with the date", async () => {
    vi.setSystemTime(TODAY);
    await renderApp();
    await settle();

    expect(document.querySelector("[data-today] h1")?.textContent).toBe(
      "Thursday, 22 October 2026",
    );
  });

  it("Today lists today's todos with their state", async () => {
    vi.setSystemTime(TODAY);
    vi.mocked(fetchTodos).mockResolvedValue([todo(3, "- [/] Draft the report 📅 2026-10-22")]);
    await renderApp();
    await settle();

    const [today] = columns();
    expect(today?.textContent).toContain("Draft the report");
    expect(today?.querySelector("[aria-label='doing']")).not.toBeNull();
  });

  it("Today lists the notes edited most recently, newest first", async () => {
    vi.setSystemTime(TODAY);
    vi.mocked(searchNotes).mockImplementation(async (query: string) =>
      query === "modified: 2026-10"
        ? [
            stamped("a.md", 2, "2026-10-20T09:00:00+00:00"),
            stamped("b.md", 2, "2026-10-21T09:00:00+00:00"),
          ]
        : [],
    );
    await renderApp();
    await settle();

    const [, recent] = columns();
    expect(rowsOf(recent)).toEqual(["b21 Oct", "a20 Oct"]);
  });

  it("Due lists overdue todos and open loops", async () => {
    vi.setSystemTime(TODAY);
    vi.mocked(fetchTodos).mockResolvedValue([
      todo(1, "- [ ] Pay the bill 📅 2026-10-01"),
      todo(2, "- [w] Wait for Anna"),
      todo(3, "- [/] Draft the report 📅 2026-10-22"),
    ]);
    await renderApp();
    await settle();

    const [, , due] = columns();
    expect(due?.textContent).toContain("Overdue");
    expect(due?.textContent).toContain("Pay the bill");
    expect(due?.textContent).toContain("Open loops");
    expect(due?.textContent).toContain("Wait for Anna");
    expect(due?.textContent).not.toContain("Draft the report");
  });

  it("each Today column says so plainly when it has nothing", async () => {
    vi.setSystemTime(TODAY);
    await renderApp();
    await settle();

    const [today, recent, due] = columns();
    expect(today?.textContent).toContain("Nothing for today.");
    expect(recent?.textContent).toContain("Nothing written lately.");
    expect(due?.textContent).toContain("Nothing due.");
  });

  it("a failed read in a Today column shows its plain line", async () => {
    vi.setSystemTime(TODAY);
    vi.mocked(fetchTodos).mockRejectedValue(new Error("the vault is down"));
    await renderApp();
    await settle();

    const [today] = columns();
    expect(today?.textContent).toContain("Nothing for today.");
  });
});
