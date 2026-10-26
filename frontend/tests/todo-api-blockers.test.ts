import { noteBase } from "@/lib/note-base";
import { periodicNote } from "@/lib/periodic";
import { cycleTodoInVault } from "@/lib/todo-api";
import { blockTodoInVault } from "@/lib/todo-line-edits";
import { todoApiHooks } from "./todo-api-fixture";

// Standing in for the module rather than for `fetch`, the way the pane's tests
// do: what this half owns is which notes it reads and what it sends back.
const { createNote, fetchNote, fetchTodos, saveNote, searchNotes, updateNote } = vi.hoisted(() => ({
  createNote: vi.fn(),
  fetchNote: vi.fn(),
  fetchTodos: vi.fn(),
  saveNote: vi.fn(),
  searchNotes: vi.fn(),
  updateNote: vi.fn(),
}));
vi.mock("@/lib/api", async (importOriginal) => {
  // The refusals the writes tell apart by class, which a factory leaving them
  // out would hand over as undefined.
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ChangedOnDisk: real.ChangedOnDisk,
    NoteExists: real.NoteExists,
    NoteMissing: real.NoteMissing,
    createNote,
    fetchNote,
    fetchTodos,
    saveNote,
    searchNotes,
    updateNote,
  };
});

todoApiHooks();

describe("blockTodoInVault", () => {
  const DOCS = { path: "docs.md", line: 2, text: "- [ ] write the docs" };
  const SHIP = { path: "release.md", line: 1, text: "- [/] ship the release" };
  const NOTES: Record<string, string> = {
    "docs.md": ["# Docs", "- [ ] write the docs"].join("\n"),
    "release.md": "- [/] ship the release",
  };

  beforeEach(() => {
    fetchNote.mockImplementation(async (path: string) => NOTES[path]);
  });

  it("stamps an id on the blocker, then names it on the dependent and blocks that", async () => {
    await blockTodoInVault(DOCS, SHIP);

    expect(saveNote).toHaveBeenCalledTimes(2);
    // The blocker first: a failure between the two leaves an id nothing
    // names rather than a `⛔` naming nothing.
    const [path, text] = saveNote.mock.calls[0] as [string, string];
    expect(path).toBe("release.md");
    const id = /^- \[\/\] ship the release 🆔 (kt-[0-9a-f]{6})$/.exec(text)?.[1];
    expect(id).toBeDefined();
    expect(saveNote).toHaveBeenLastCalledWith(
      "docs.md",
      ["# Docs", `- [b] write the docs ⛔ ${id}`].join("\n"),
      false,
      expect.any(String),
    );
  });

  it("keeps the blocker's line byte for byte but for the id it stamps", async () => {
    const lines = ["# Release", "- [ ] parent", "\t- [ ] blocker zork 🜲 words 📅 2026-10-20 ^blk1"];
    const blocker = { path: "release.md", line: 3, text: lines[2] as string };
    fetchNote.mockImplementation(async (path: string) =>
      path === "release.md" ? lines.join("\n") : NOTES[path],
    );

    await blockTodoInVault(DOCS, blocker);

    const [path, text] = saveNote.mock.calls[0] as [string, string];
    expect(path).toBe("release.md");
    const id = /🆔 (kt-[0-9a-f]{6})/.exec(text)?.[1];
    expect(id).toBeDefined();
    expect(text).toBe(
      [
        "# Release",
        "- [ ] parent",
        `\t- [ ] blocker zork 🜲 words 📅 2026-10-20 🆔 ${id} ^blk1`,
      ].join("\n"),
    );
  });

  it("leaves a blocker that carries an id alone", async () => {
    const ship = { ...SHIP, text: "- [/] ship the release 🆔 kt-c0ffee" };
    fetchNote.mockImplementation(async (path: string) =>
      path === "release.md" ? ship.text : NOTES[path],
    );

    await blockTodoInVault(DOCS, ship);

    expect(saveNote).toHaveBeenCalledExactlyOnceWith(
      "docs.md",
      ["# Docs", "- [b] write the docs ⛔ kt-c0ffee"].join("\n"),
      false,
      expect.any(String),
    );
  });

  it("writes one note once where it holds both", async () => {
    const note = ["- [ ] ship the release 🆔 kt-c0ffee", "- [/] write the docs"].join("\n");
    fetchNote.mockResolvedValue(note);

    await blockTodoInVault(
      { path: "a.md", line: 2, text: "- [/] write the docs" },
      { path: "a.md", line: 1, text: "- [ ] ship the release 🆔 kt-c0ffee" },
    );

    // Doing stays doing: kasten moves a `⛔` line between open and blocked only.
    expect(saveNote).toHaveBeenCalledExactlyOnceWith(
      "a.md",
      ["- [ ] ship the release 🆔 kt-c0ffee", "- [/] write the docs ⛔ kt-c0ffee"].join("\n"),
      false,
      noteBase(note),
    );
  });

  it("names the text it read of each note as that write's base", async () => {
    await blockTodoInVault(DOCS, SHIP);

    expect(saveNote.mock.calls.map((call) => call.slice(2))).toEqual([
      [false, noteBase(NOTES["release.md"] ?? "")],
      [false, noteBase(NOTES["docs.md"] ?? "")],
    ]);
  });

  it("writes nothing, not even the id, where either note moved under its row", async () => {
    await blockTodoInVault({ ...DOCS, line: 1 }, SHIP);
    await blockTodoInVault(DOCS, { ...SHIP, text: "- [ ] ship the release" });

    expect(saveNote).not.toHaveBeenCalled();
  });
});

describe("#537 a ⛔ naming a 🆔 two todos carry", () => {
  const daily = periodicNote("daily", new Date()).path;

  /** The vault as `notes`, written back as each save lands. */
  function serve(notes: Record<string, string>) {
    fetchNote.mockImplementation(async (path: string) => notes[path]);
    saveNote.mockImplementation(async (path: string, text: string) => {
      notes[path] = text;
    });
  }

  it("#537 A5 setting d done leaves c blocked in the issue's note", async () => {
    const lines = [
      "- [ ] a 🆔 kt-aaaaaa",
      "- [x] a 🆔 kt-aaaaaa",
      "- [b] c ⛔ kt-aaaaaa",
      "- [ ] d 🆔 kt-dddddd",
      "- [b] e ⛔ kt-dddddd",
    ];
    const notes: Record<string, string> = { "inbox.md": lines.join("\n"), [daily]: "## Done\n" };
    serve(notes);
    fetchTodos.mockResolvedValue(
      lines.map((text, index) => ({
        path: "inbox.md",
        line: index + 1,
        text,
        project: null,
        shared: false,
      })),
    );

    await cycleTodoInVault(
      { path: "inbox.md", line: 4, text: "- [ ] d 🆔 kt-dddddd" },
      "2026-08-10",
      ["inbox.md", daily],
      "done",
    );

    expect(notes["inbox.md"]).toBe(
      [
        "- [ ] a 🆔 kt-aaaaaa",
        "- [x] a 🆔 kt-aaaaaa",
        "- [b] c ⛔ kt-aaaaaa",
        "- [x] d ✅ 2026-08-10 🆔 kt-dddddd",
        "- [ ] e ⛔ kt-dddddd",
      ].join("\n"),
    );
  });

  it("#537 A5 the write back leaves a dependent in another note on a twinned 🆔", async () => {
    // The pressed todo closes, and the dependent's other blocker is the twinned
    // one, whose done twin is listed last.
    const notes: Record<string, string> = {
      "d.md": "- [/] d 🆔 kt-dddddd",
      "deps.md": "- [b] c ⛔ kt-dddddd ⛔ kt-aaaaaa",
      [daily]: "## Done\n",
    };
    serve(notes);
    fetchTodos.mockResolvedValue([
      { path: "d.md", line: 1, text: "- [/] d 🆔 kt-dddddd", project: null, shared: false },
      { path: "a.md", line: 1, text: "- [ ] a 🆔 kt-aaaaaa", project: null, shared: false },
      { path: "b.md", line: 1, text: "- [x] a 🆔 kt-aaaaaa", project: null, shared: false },
      {
        path: "deps.md",
        line: 1,
        text: "- [b] c ⛔ kt-dddddd ⛔ kt-aaaaaa",
        project: null,
        shared: false,
      },
    ]);

    await cycleTodoInVault(
      { path: "d.md", line: 1, text: "- [/] d 🆔 kt-dddddd" },
      "2026-08-10",
      ["d.md", "deps.md", daily],
      "done",
    );

    expect(notes["d.md"]).toBe("- [x] d ✅ 2026-08-10 🆔 kt-dddddd");
    expect(notes["deps.md"]).toBe("- [b] c ⛔ kt-dddddd ⛔ kt-aaaaaa");
  });

  it("#537 A6 blocking on a todo whose 🆔 stands on another todo writes nothing and names the other", async () => {
    const docs = { path: "docs.md", line: 2, text: "- [ ] write the docs" };
    const blocker = { path: "release.md", line: 1, text: "- [ ] a 🆔 kt-aaaaaa" };
    serve({ "docs.md": "# Docs\n- [ ] write the docs", "release.md": blocker.text });
    fetchTodos.mockResolvedValue([
      { ...docs, project: null, shared: false },
      { ...blocker, project: null, shared: false },
      { path: "other.md", line: 3, text: "- [x] a 🆔 kt-aaaaaa", project: null, shared: false },
    ]);

    await expect(blockTodoInVault(docs, blocker)).rejects.toThrow(
      "🆔 kt-aaaaaa is on another todo too: other.md line 3",
    );

    expect(saveNote).not.toHaveBeenCalled();
  });
});
