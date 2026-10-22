import { EditorView } from "@codemirror/view";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { NoteMissing } from "@/lib/api";
import { holdText } from "@/lib/held-text";
import { noteBase } from "@/lib/note-base";
import { periodicNote } from "@/lib/periodic";
import { hashed } from "./digests";
import { defineFoliateFake } from "./foliate-fake";
import {
  act,
  FakeEventSource,
  pageHooks,
  renderApp,
  settle,
  stream,
  VAULT,
} from "./home-route-fixture";
import { COARSE, NARROW, stubMatchMedia } from "./match-media";

defineFoliateFake();

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
  renameNote,
  moveFolder,
  deleteNote,
  fetchTrash,
  restoreEntry,
  deleteImage,
  fetchHistory,
  fetchHistoryText,
} = vi.hoisted(() => {
  const beside = (note: string, suffix = ".epub") => ({
    path: note.replace(/\.md$/, suffix),
    blob: new Blob(["a book"]),
  });

  const fetchNote = vi.fn();
  const saveNote = vi.fn();

  return {
    fetchFiles: vi.fn(),
    fetchNote,
    saveNote,
    updateNote: vi.fn(async (path: string, change: (text: string) => string | null) => {
      const text: string = await fetchNote(path);
      const next = change(text);
      return next === null ? null : saveNote(path, next, false, noteBase(text));
    }),
    searchNotes: vi.fn(),
    fetchMentions: vi.fn(),
    createNote: vi.fn(),
    fetchTerminals: vi.fn().mockResolvedValue([]),
    fetchTodos: vi.fn().mockResolvedValue([]),
    fetchBook: vi.fn(async (note: string) => beside(note)),
    uploadAsset: vi.fn().mockResolvedValue(undefined),
    fetchImages: vi.fn().mockResolvedValue([]),
    fetchHtml: vi.fn().mockResolvedValue([]),
    fetchAssets: vi.fn().mockResolvedValue([]),
    fetchVersion: vi.fn().mockResolvedValue("0.8.0"),
    fetchTags: vi.fn().mockResolvedValue([]),
    renameNote: vi.fn(),
    moveFolder: vi.fn(),
    deleteNote: vi.fn(),
    fetchTrash: vi.fn(),
    restoreEntry: vi.fn(),
    deleteImage: vi.fn(),
    fetchHistory: vi.fn(),
    fetchHistoryText: vi.fn(),
  };
});
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

// Pinned to a day, since the drink lands in the note the clock names.
const TODAY = periodicNote("daily", new Date(2026, 9, 20, 9, 0)).path;
const TODAY_TEXT = "---\ntype: Periodic Note\n---\n\n# 2026-10-20 Tuesday\n\n## TODOs\n";
const LOG_CONFIG = "99 Misc/01 Config/log.md";

describe("the palette's drink rows, on the route", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 20, 9, 0));
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue([...Object.keys(VAULT), TODAY]);
    fetchNote.mockImplementation(async (path: string) => {
      // The log config note is missing here, as in a vault without it, so the card draws its defaults.
      if (path === "99 Misc/01 Config/log.md") throw new NoteMissing(path);
      return path === TODAY ? TODAY_TEXT : VAULT[path];
    });
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchTodos.mockResolvedValue([]);
    fetchTags.mockResolvedValue([]);
    fetchImages.mockResolvedValue([]);
    fetchHtml.mockResolvedValue([]);
    fetchAssets.mockResolvedValue([]);
  });

  afterEach(async () => {
    cleanup();
    await hashed();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  const option = (name: string | RegExp) => screen.queryByRole("option", { name });
  const editorText = () =>
    EditorView.findFromDOM(
      document.querySelector(".cm-editor") as HTMLElement,
    )?.state.doc.toString();
  /**
   * The palette's drink rows, in the order it lists them. `Log food` is the card's
   * own row, listed over a daily note, and is not a drink.
   */
  const logRows = () =>
    screen
      .queryAllByRole("option", { name: /^Log (?!food$)/ })
      .map((row) => row.textContent?.trim());
  /** The card's button called `name`, by its label, or null where the card draws none. */
  const cardButton = (name: string) =>
    document.querySelector(`.cm-log button[aria-label='${name}']`);
  /** Taps the palette row called `name`. A missing row is a failed assertion, not a throw. */
  function tapRow(name: RegExp) {
    const row = option(name);
    expect.soft(row).not.toBeNull();
    if (row) fireEvent.click(row);
  }

  /** Answers for log.md with `answer`: its text, or the error it fails with. */
  function withLog(answer: string | Error) {
    fetchNote.mockImplementation(async (path: string) => {
      if (path === LOG_CONFIG) {
        if (answer instanceof Error) throw answer;
        return answer;
      }
      return path === TODAY ? TODAY_TEXT : VAULT[path];
    });
  }

  it("the palette logs into today's focused pane when the focus is off its editor", async () => {
    const app = await renderApp(`/?note=${encodeURIComponent(TODAY)}`);
    await settle();
    // Focus on the body, as after a click on the tree: the palette finds no view.
    (document.activeElement as HTMLElement | null)?.blur();

    app.leader(":");
    await settle();
    const row = option(/^Log water/);
    expect.soft(row).not.toBeNull();
    if (row) fireEvent.click(row);
    await settle();

    expect(editorText()).toContain("## Log\n- 💧 250 ml");
    expect(saveNote).not.toHaveBeenCalled();
  });

  it("the palette logs nothing while today's note holds text not yet saved", async () => {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    holdText(TODAY, { content: "typed", reason: "PUT failed with 500", conflicted: false });

    app.leader(":");
    await settle();
    const row = option(/^Log water/);
    expect.soft(row).not.toBeNull();
    if (row) fireEvent.click(row);
    await settle();

    expect(app.notice()).toBe(`Nothing logged: ${TODAY} holds text not yet saved`);
    expect(saveNote).not.toHaveBeenCalled();
  });

  it("#770 without log.md the palette offers Log water, coffee and alcohol and Log water writes - 💧 250 ml", async () => {
    withLog(new NoteMissing(LOG_CONFIG));
    const app = await renderApp(`/?note=${encodeURIComponent(TODAY)}`);
    await settle();

    app.leader(":");
    await settle();
    expect(logRows()).toEqual(["Log water", "Log coffee", "Log alcohol"]);
    tapRow(/^Log water/);
    await settle();

    expect(editorText()).toContain("## Log\n- 💧 250 ml");
  });

  it("#770 with log.md the palette offers exactly its kinds and Log tea writes - 🍵 1 cup into today's focused note", async () => {
    withLog("- 💧 water: 250 ml\n- 🍵 tea: 1 cup\n");
    const app = await renderApp(`/?note=${encodeURIComponent(TODAY)}`);
    await settle();

    app.leader(":");
    await settle();
    expect(logRows()).toEqual(["Log water", "Log tea"]);
    tapRow(/^Log tea/);
    await settle();

    expect(editorText()).toContain("## Log\n- 🍵 1 cup");
    expect(saveNote).not.toHaveBeenCalled();
  });

  it("#770 Log tea from another note writes - 🍵 1 cup into today's note through the vault", async () => {
    withLog("- 💧 water: 250 ml\n- 🍵 tea: 1 cup\n");
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();

    app.leader(":");
    await settle();
    tapRow(/^Log tea/);
    await settle();

    expect(saveNote).toHaveBeenCalledWith(
      TODAY,
      expect.stringContaining("## Log\n- 🍵 1 cup"),
      false,
      expect.anything(),
    );
    expect(app.notice()).toBe("Logged 🍵 1 cup into today's note");
  });

  it("#770 a configured water tap of 500 ml writes - 💧 500 ml from the palette and the notice names it", async () => {
    withLog("- 💧 water: 500 ml\n");
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();

    app.leader(":");
    await settle();
    tapRow(/^Log water/);
    await settle();

    expect(saveNote).toHaveBeenCalledWith(
      TODAY,
      expect.stringContaining("## Log\n- 💧 500 ml"),
      false,
      expect.anything(),
    );
    expect(app.notice()).toBe("Logged 💧 500 ml into today's note");
  });

  it("#770 the palette's entries follow a write to log.md without a reload", async () => {
    withLog(new NoteMissing(LOG_CONFIG));
    const app = await renderApp(`/?note=${encodeURIComponent(TODAY)}`);
    await settle();
    app.leader(":");
    await settle();
    expect.soft(option(/^Log tea/)).toBeNull();

    // The palette stays open across the event, so its rows are the ones the event redraws.
    withLog("- 🍵 tea: 1 cup\n");
    act(() => stream().send({ path: LOG_CONFIG, change: "written", digest: "a".repeat(64) }));
    await settle();

    expect(option(/^Log tea/)).not.toBeNull();
  });

  it("#770 a removed log.md puts the palette back on the default kinds", async () => {
    withLog("- 🍵 tea: 1 cup\n");
    const app = await renderApp(`/?note=${encodeURIComponent(TODAY)}`);
    await settle();
    app.leader(":");
    await settle();
    expect.soft(option(/^Log tea/)).not.toBeNull();

    withLog(new NoteMissing(LOG_CONFIG));
    act(() => stream().send({ path: LOG_CONFIG, change: "removed", digest: null }));
    await settle();

    expect(logRows()).toEqual(["Log water", "Log coffee", "Log alcohol"]);
  });

  it("#770 a log.md that fails to load gives the default palette", async () => {
    withLog(new Error("the vault is down"));
    const app = await renderApp(`/?note=${encodeURIComponent(TODAY)}`);
    await settle();

    app.leader(":");
    await settle();

    expect(logRows()).toEqual(["Log water", "Log coffee", "Log alcohol"]);
  });

  it("#770 a broken line in log.md gives no palette entry and the other kinds still do", async () => {
    withLog("- 🧃 juice: lots\n- 🍵 tea: 1 cup\n");
    const app = await renderApp(`/?note=${encodeURIComponent(TODAY)}`);
    await settle();

    app.leader(":");
    await settle();

    expect(logRows()).toEqual(["Log tea"]);
  });

  it("#770 on a phone, the toolbar's run button opens the palette and Log tea writes into today's note", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    withLog("- 🍵 tea: 1 cup\n");
    await renderApp(`/?note=${encodeURIComponent(TODAY)}`);
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "Run a command by name" }));
    await settle();
    tapRow(/^Log tea/);
    await settle();

    expect(editorText()).toContain("## Log\n- 🍵 1 cup");
  });

  it("#770 a conflicted log.md kept and closed is read off the vault again when opened", async () => {
    // The vault lists log.md, so the route can open it as it opens any note.
    fetchFiles.mockResolvedValue([...Object.keys(VAULT), TODAY, LOG_CONFIG]);
    withLog("- 🍵 tea: 1 cup\n");
    const app = await renderApp(`/?note=${encodeURIComponent(LOG_CONFIG)}`);
    await settle();
    // Closed with the route still mounted, so the route's own query stays observed.
    app.leader("q");
    await settle();

    // Kept while closed, as the reader's own write left it standing conflicted.
    holdText(LOG_CONFIG, {
      content: "typed",
      reason: "PUT failed with 409",
      conflicted: true,
    });
    await settle();

    // The cached text is let go, so opening the note reads the vault again.
    expect(app.cached(LOG_CONFIG)).toBeUndefined();
  });

  it("#770 a failed refetch of log.md keeps its kinds in the palette", async () => {
    withLog("- 🍵 tea: 1 cup\n");
    const app = await renderApp(`/?note=${encodeURIComponent(TODAY)}`);
    await settle();
    app.leader(":");
    await settle();
    expect.soft(option(/^Log tea/)).not.toBeNull();

    // The vault fails the reread of log.md, and the palette keeps the kinds it had.
    withLog(new Error("the vault is down"));
    act(() => stream().send({ path: LOG_CONFIG, change: "written", digest: "a".repeat(64) }));
    await settle();

    expect(option(/^Log tea/)).not.toBeNull();
  });

  it("#818 a kind added to log.md while the stream was down shows in the palette and on the card once the stream opens again", async () => {
    withLog("- 💧 water: 250 ml\n");
    const app = await renderApp(`/?note=${encodeURIComponent(TODAY)}`);
    await settle();
    // The first open is the stream coming up, before anything was missed.
    act(() => stream().onopen?.());
    await settle();

    // The stream is down while log.md gains tea, and the reopen is what asks again.
    withLog("- 💧 water: 250 ml\n- 🍵 tea: 1 cup\n");
    act(() => stream().onopen?.());
    await settle();

    expect.soft(cardButton("Log tea")).not.toBeNull();
    app.leader(":");
    await settle();
    expect.soft(option(/^Log tea/)).not.toBeNull();
  });

  it("#818 a log.md written while the stream is up puts its new kind on the card", async () => {
    withLog("- 💧 water: 250 ml\n");
    await renderApp(`/?note=${encodeURIComponent(TODAY)}`);
    await settle();
    expect.soft(cardButton("Log tea")).toBeNull();

    withLog("- 💧 water: 250 ml\n- 🍵 tea: 1 cup\n");
    act(() => stream().send({ path: LOG_CONFIG, change: "written", digest: "a".repeat(64) }));
    await settle();

    expect(cardButton("Log tea")).not.toBeNull();
  });

  it("#818 the first open of the stream asks log.md no more often than the mount did", async () => {
    withLog("- 💧 water: 250 ml\n");
    await renderApp(`/?note=${encodeURIComponent(TODAY)}`);
    // Opened while the mount's own fetches are still in the air, as the first open is.
    act(() => stream().onopen?.());
    await settle();

    expect(fetchNote.mock.calls.filter(([path]) => path === LOG_CONFIG)).toHaveLength(2);
  });

  it("#818 a log.md removed while the stream was down puts the palette and the card back on the default kinds at reopen", async () => {
    withLog("- 🍵 tea: 1 cup\n");
    const app = await renderApp(`/?note=${encodeURIComponent(TODAY)}`);
    await settle();
    expect.soft(cardButton("Log tea")).not.toBeNull();

    withLog(new NoteMissing(LOG_CONFIG));
    act(() => stream().onopen?.());
    await settle();

    expect.soft(cardButton("Log tea")).toBeNull();
    app.leader(":");
    await settle();
    expect(logRows()).toEqual(["Log water", "Log coffee", "Log alcohol"]);
  });

  it("#818 a config arriving at reopen keeps the open food search's query text and focus", async () => {
    withLog("- 💧 water: 250 ml\n");
    await renderApp(`/?note=${encodeURIComponent(TODAY)}`);
    await settle();
    const food = cardButton("Log food");
    expect(food).not.toBeNull();
    if (food) fireEvent.click(food);
    await settle();
    const query = document.querySelector<HTMLInputElement>(".cm-log-food-query");
    expect(query).not.toBeNull();
    if (query) fireEvent.input(query, { target: { value: "apple" } });
    query?.focus();

    withLog("- 💧 water: 250 ml\n- 🍵 tea: 1 cup\n");
    act(() => stream().onopen?.());
    await settle();

    expect.soft(query?.value).toBe("apple");
    expect.soft(document.activeElement).toBe(query);
    expect(cardButton("Log tea")).not.toBeNull();
  });

  it("#818 two reloads of log.md that answer out of order leave the card on the newer kinds", async () => {
    withLog("- 💧 water: 250 ml\n");
    await renderApp(`/?note=${encodeURIComponent(TODAY)}`);
    await settle();

    // Every read of log.md from here waits until the test answers it.
    const held: ((text: string) => void)[] = [];
    fetchNote.mockImplementation(async (path: string) => {
      if (path === LOG_CONFIG) {
        return new Promise<string>((resolve) => {
          held.push(resolve);
        });
      }
      return path === TODAY ? TODAY_TEXT : VAULT[path];
    });
    act(() => stream().send({ path: LOG_CONFIG, change: "written", digest: "a".repeat(64) }));
    act(() => stream().send({ path: LOG_CONFIG, change: "written", digest: "b".repeat(64) }));
    await settle();

    // The newest read answers first with tea, and the older one lands after it with the old kinds.
    const newest = held[held.length - 1];
    act(() => newest?.("- 🍵 tea: 1 cup\n"));
    await settle();
    act(() => {
      for (const answer of held.slice(0, -1)) answer("- 💧 water: 250 ml\n");
    });
    await settle();

    expect(cardButton("Log tea")).not.toBeNull();
  });

  it("#818 a reopen that cannot read log.md keeps the kinds the card has", async () => {
    withLog("- 🍵 tea: 1 cup\n");
    await renderApp(`/?note=${encodeURIComponent(TODAY)}`);
    await settle();
    expect.soft(cardButton("Log tea")).not.toBeNull();

    // The vault is down for the read, as it is while the backend restarts.
    withLog(new Error("the vault is down"));
    act(() => stream().onopen?.());
    await settle();

    expect(cardButton("Log tea")).not.toBeNull();
  });

  it("#826 a log.md written while the card's first read is out leaves the card and the palette on the new kinds", async () => {
    withLog("- 💧 water: 250 ml\n");
    // Every read of log.md waits until the test answers it, the mount's own first read included.
    const held: ((text: string) => void)[] = [];
    fetchNote.mockImplementation(async (path: string) => {
      if (path === LOG_CONFIG) {
        return new Promise<string>((resolve) => {
          held.push(resolve);
        });
      }
      return path === TODAY ? TODAY_TEXT : VAULT[path];
    });
    const app = await renderApp(`/?note=${encodeURIComponent(TODAY)}`);
    await settle();
    const first = held.length;
    expect.soft(first).toBeGreaterThan(0);

    act(() => stream().send({ path: LOG_CONFIG, change: "written", digest: "a".repeat(64) }));
    await settle();

    // The reads after the event know tea, and the mount's older reads land after them with the old kinds.
    act(() => {
      for (const answer of held.slice(first)) answer("- 💧 water: 250 ml\n- 🍵 tea: 1 cup\n");
    });
    await settle();
    act(() => {
      for (const answer of held.slice(0, first)) answer("- 💧 water: 250 ml\n");
    });
    await settle();

    expect.soft(cardButton("Log tea")).not.toBeNull();
    app.leader(":");
    await settle();
    expect(option(/^Log tea/)).not.toBeNull();
  });
});
