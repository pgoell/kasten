import { noteBase } from "@/lib/note-base";
import { periodicNote } from "@/lib/periodic";
import {
  addSubtaskInVault,
  addTodoInVault,
  blockTodoInVault,
  cycleTodoInVault,
  editTodoInVault,
} from "@/lib/todo-api";

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
vi.mock("@/lib/api", () => ({
  createNote,
  fetchNote,
  fetchTodos,
  saveNote,
  searchNotes,
  updateNote,
}));

beforeEach(() => {
  // One try over the fakes above. The retries on a 409 are `update-note.test.ts`'s.
  updateNote.mockImplementation(async (path: string, change: (text: string) => string | null) => {
    const text = await fetchNote(path);
    const next = change(text);
    return next === null ? null : saveNote(path, next, false, noteBase(text));
  });
  createNote.mockReset();
  createNote.mockResolvedValue(undefined);
  fetchNote.mockReset();
  fetchTodos.mockReset();
  fetchTodos.mockResolvedValue([]);
  saveNote.mockReset();
  saveNote.mockResolvedValue(undefined);
  searchNotes.mockReset();
  searchNotes.mockResolvedValue([]);
});

const NOTE = ["# Kasten", "", "- [ ] call the dentist 📅 2026-08-14 🆔 kt-3f9a2c", ""].join("\n");

const HIT = {
  path: "projects/kasten.md",
  line: 3,
  text: "- [ ] call the dentist 📅 2026-08-14 🆔 kt-3f9a2c",
};

describe("editTodoInVault", () => {
  it("puts the edited line back, and leaves every other line alone", async () => {
    fetchNote.mockResolvedValue(NOTE);

    await editTodoInVault(HIT, "  - [/] call the dentist 📅 2026-08-15 🆔 kt-3f9a2c");

    expect(saveNote).toHaveBeenCalledExactlyOnceWith(
      "projects/kasten.md",
      ["# Kasten", "", "  - [/] call the dentist 📅 2026-08-15 🆔 kt-3f9a2c", ""].join("\n"),
      false,
      noteBase(NOTE),
    );
  });

  it("writes nothing where the note moved under the row", async () => {
    // An edit replaces the line rather than rewriting what it finds, so a stale
    // row would put the dentist over whatever now sits at line 3.
    fetchNote.mockResolvedValue(NOTE.replace("- [ ] call the dentist", "- [ ] buy milk"));

    await editTodoInVault(HIT, "- [ ] call the dentist 📅 2026-08-15");

    expect(saveNote).not.toHaveBeenCalled();
  });
});

describe("editTodoInVault, on a blocked line", () => {
  it("opens the line where the edit deleted its last blocker", async () => {
    const hit = { path: "a.md", line: 1, text: "- [b] write the docs ⛔ kt-c0ffee" };
    fetchNote.mockResolvedValue(hit.text);

    await editTodoInVault(hit, "- [b] write the docs");

    expect(saveNote).toHaveBeenCalledExactlyOnceWith(
      "a.md",
      "- [ ] write the docs",
      false,
      noteBase(hit.text),
    );
  });
});

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

describe("addSubtaskInVault", () => {
  it("writes the shorthand into the note the parent lives in", async () => {
    fetchNote.mockResolvedValue(NOTE);

    await addSubtaskInVault(HIT, "ring the practice due:08-12 !high", "2026-08-10");

    expect(saveNote).toHaveBeenCalledExactlyOnceWith(
      "projects/kasten.md",
      [
        "# Kasten",
        "",
        "- [ ] call the dentist 📅 2026-08-14 🆔 kt-3f9a2c",
        "  - [ ] ring the practice 📅 2026-08-12 ⏫ ➕ 2026-08-10",
        "",
      ].join("\n"),
      false,
      noteBase(NOTE),
    );
  });

  it("writes nothing where the note moved under the row", async () => {
    // The part is placed off the parent's line, so a stale row would hang it
    // under whatever now sits at line 3.
    fetchNote.mockResolvedValue(NOTE.replace("- [ ] call the dentist", "- [ ] buy milk"));

    await addSubtaskInVault(HIT, "ring the practice", "2026-08-10");

    expect(saveNote).not.toHaveBeenCalled();
  });
});

describe("cycleTodoInVault", () => {
  it("writes no second log line ticking a review todo whose day already logged it", async () => {
    // An agent moved the todo back from done to review, and the line its first
    // tick wrote is still under today's `## Done`.
    const daily = periodicNote("daily", new Date()).path;
    const line = "- [r] a 🆔 kt-aaaaaa";
    const log = "## Done\n- ✅ 2026-08-10 a [[projects/kasten]] kt-aaaaaa\n";
    const notes: Record<string, string> = { "projects/kasten.md": `${line}\n`, [daily]: log };
    fetchNote.mockImplementation(async (path: string) => notes[path]);
    searchNotes.mockResolvedValue([
      { path: "projects/kasten.md", line: 1, text: line },
      { path: daily, line: 2, text: "- ✅ 2026-08-10 a [[projects/kasten]] kt-aaaaaa" },
    ]);

    await cycleTodoInVault({ path: "projects/kasten.md", line: 1, text: line }, "2026-08-10", [
      "projects/kasten.md",
      daily,
    ]);

    expect(saveNote).toHaveBeenCalledExactlyOnceWith(
      "projects/kasten.md",
      "- [x] a ✅ 2026-08-10 🆔 kt-aaaaaa\n",
      false,
      noteBase(`${line}\n`),
    );
  });
});

describe("addTodoInVault", () => {
  it("makes today's note with a block saying it is periodic", async () => {
    // The first todo of a day is the other way a daily note is made, and it
    // has to write the same first line the leader key writes: a fence anywhere
    // but the top is prose, and the note would carry no type at all.
    await addTodoInVault("call the dentist", "2026-08-06", []);

    const [, text] = createNote.mock.calls[0] as [string, string];
    expect(text.split("\n").slice(0, 3)).toEqual(["---", "type: Periodic Note", "---"]);
  });

  it("names the daily note it read as the base of its write", async () => {
    const daily = periodicNote("daily", new Date()).path;
    fetchNote.mockResolvedValue("# Today\n");

    await addTodoInVault("call the dentist", "2026-08-06", [daily]);

    expect(saveNote).toHaveBeenCalledExactlyOnceWith(
      daily,
      expect.stringContaining("call the dentist"),
      false,
      noteBase("# Today\n"),
    );
  });
});
