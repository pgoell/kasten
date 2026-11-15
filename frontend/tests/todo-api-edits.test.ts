// @vitest-environment node
import { NoteMissing } from "@/lib/core/api";
import { noteBase } from "@/lib/notes/note-base";
import { periodicNote } from "@/lib/notes/text/periodic";
import {
  addTodoInVault,
  agentTodoIn,
  cycleTodoInVault,
  toggleTimerInVault,
} from "@/lib/todo/todo-api";
import { addSubtaskInVault, blockTodoInVault, editTodoInVault } from "@/lib/todo/todo-line-edits";
import { followRow, keepLanded, twinsOf } from "@/lib/todo/todo-press-echo";
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
vi.mock("@/lib/core/api", async (importOriginal) => {
  // The refusals the writes tell apart by class, which a factory leaving them
  // out would hand over as undefined.
  const real = await importOriginal<typeof import("@/lib/core/api")>();
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

// The code stamps today's date at the write, after the test has read it. A run
// that crosses local midnight would see another day and the two would disagree
// (#1315), so the clock is pinned for every test and restored after it.
const NOW = new Date(2026, 7, 10, 12);

beforeEach(() => {
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
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

describe("#2087 an edit row through a redraw", () => {
  it("answers whether the edit wrote: true where it landed, false where the line changed under it", async () => {
    fetchNote.mockResolvedValue(NOTE);
    expect(await editTodoInVault(HIT, "- [ ] call the dentist now")).toBe(true);
    fetchNote.mockResolvedValue(NOTE.replace("call the dentist", "call the vet"));
    expect(await editTodoInVault(HIT, "- [ ] call the dentist now")).toBe(false);
  });

  const at = { path: "a.md", line: 2, text: "- [ ] same" };
  const row = (line: number, text = "- [ ] same", path = "a.md") => ({ path, line, text });

  it("follows the one line of its note that says its words, wherever the redraw moved it", () => {
    const rows = [row(1, "- [ ] other"), row(5), row(5, "- [ ] same", "b.md")];
    expect(followRow(at, { nth: 0, of: 1 }, rows)).toEqual(row(5));
  });

  it("follows the same one of two twins by their order, and none where their count changed", () => {
    const twins = twinsOf(row(3), [row(2), row(3)]);
    expect(twins).toEqual({ nth: 1, of: 2 });
    expect(followRow(row(3), twins, [row(3), row(4)])).toEqual(row(4));
    expect(followRow(row(3), twins, [row(3)])).toBeNull();
  });

  it("stays on its own line where that line's words changed, and is gone where no row is left there", () => {
    expect(followRow(at, { nth: 0, of: 1 }, [row(2, "- [ ] new words")])).toEqual(
      row(2, "- [ ] new words"),
    );
    expect(followRow(at, { nth: 0, of: 1 }, [row(1, "- [ ] other")])).toBeNull();
  });

  it("follows where an x left a row whose words the x changed", () => {
    keepLanded([at], row(5, "- [/] same"));
    expect(followRow(at, { nth: 0, of: 1 }, [row(2, "- [ ] other"), row(5, "- [/] same")])).toEqual(
      row(5, "- [/] same"),
    );
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

describe("addTodoInVault", () => {
  it("makes today's note with a block saying it is periodic", async () => {
    // The first todo of a day is the other way a daily note is made, and it
    // has to write the same first line the leader key writes: a fence anywhere
    // but the top is prose, and the note would carry no type at all.
    fetchNote.mockRejectedValue(new NoteMissing(periodicNote("daily", NOW).path));

    await addTodoInVault("call the dentist", "2026-08-06");

    const [, text] = createNote.mock.calls[0] as [string, string];
    expect(text.split("\n").slice(0, 3)).toEqual(["---", "type: Periodic Note", "---"]);
  });

  it("writes into today's note when a press ahead of it made the note after the listing", async () => {
    const daily = periodicNote("daily", NOW).path;
    fetchNote.mockResolvedValue("# Today\n");

    await addTodoInVault("call the dentist", "2026-08-06");

    expect(createNote).not.toHaveBeenCalled();
    expect(saveNote).toHaveBeenCalledExactlyOnceWith(
      daily,
      expect.stringContaining("call the dentist"),
      false,
      noteBase("# Today\n"),
    );
  });

  it("waits for the write before it, so two never race on today's note", async () => {
    vi.useFakeTimers({ now: NOW });
    let land = () => {};
    fetchNote.mockReturnValueOnce(new Promise((resolve) => (land = () => resolve("# Today\n"))));
    fetchNote.mockResolvedValue("# Today\n");

    const first = addTodoInVault("call the dentist", "2026-08-06");
    const second = addTodoInVault("buy milk", "2026-08-06");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchNote).toHaveBeenCalledTimes(1);

    land();
    await Promise.all([first, second]);
    expect(saveNote).toHaveBeenCalledTimes(2);
  });

  it("goes on alone once the write before it has hung for ten seconds", async () => {
    vi.useFakeTimers({ now: NOW });
    fetchNote.mockReturnValueOnce(new Promise(() => {}));
    fetchNote.mockResolvedValue("# Today\n");
    const daily = periodicNote("daily", NOW).path;

    void addTodoInVault("call the dentist", "2026-08-06");
    const second = addTodoInVault("buy milk", "2026-08-06");
    await vi.advanceTimersByTimeAsync(10_000);
    await second;

    expect(saveNote).toHaveBeenCalledExactlyOnceWith(
      daily,
      expect.stringContaining("buy milk"),
      false,
      expect.anything(),
    );
  });

  it("names the daily note it read as the base of its write", async () => {
    const daily = periodicNote("daily", NOW).path;
    fetchNote.mockResolvedValue("# Today\n");

    await addTodoInVault("call the dentist", "2026-08-06");

    expect(saveNote).toHaveBeenCalledExactlyOnceWith(
      daily,
      expect.stringContaining("call the dentist"),
      false,
      noteBase("# Today\n"),
    );
  });
});

describe("#2084 a key read before an x landed", () => {
  const STAMP = "---\nid: g\n---\n";
  const TODAY = "2026-08-10";
  /** A vault whose first save of a note answers with a frontmatter block stamped on top. */
  function vault(notes: Record<string, string>) {
    const disk = new Map(
      Object.entries({ [periodicNote("daily", NOW).path]: "# day\n", ...notes }),
    );
    fetchNote.mockImplementation(async (path: string) => disk.get(path) ?? "");
    saveNote.mockImplementation(async (path: string, text: string) => {
      const content = text.startsWith("---\n") ? text : `${STAMP}${text}`;
      disk.set(path, content);
      return { path, content };
    });
    return disk;
  }
  const row = (path: string) => ({ path, line: 2, text: "- [ ] a" });
  const x = (path: string, id = "kt-aaaaaa") =>
    cycleTodoInVault(row(path), TODAY, undefined, undefined, id);

  it("t starts a session on the todo the x walked", async () => {
    const disk = vault({ "k1.md": "# K\n- [ ] a\n" });
    await x("k1.md");
    await toggleTimerInVault(row("k1.md"), { date: TODAY, time: "09:00" });
    expect(disk.get(periodicNote("daily", NOW).path)).toMatch(/^- 09:00- .*a/m);
    expect(disk.get("k1.md")).toMatch(/^- \[\/\] a 🆔 kt-\w+$/m);
  });

  it("@ tags the line the x wrote", () => {
    const disk = vault({ "k2.md": "# K\n- [ ] a\n" });
    return x("k2.md").then(() => {
      const tagged = agentTodoIn(disk.get("k2.md") ?? "", row("k2.md"), TODAY);
      expect(tagged).toMatchObject({ line: expect.stringMatching(/^- \[\/\] a .*#agent/) });
    });
  });

  it("an edit of the row as drawn goes onto the line the x wrote", async () => {
    const disk = vault({ "k3.md": "# K\n- [ ] a\n" });
    await x("k3.md");
    const drawn = { ...row("k3.md"), text: "- [/] a" };
    await editTodoInVault(drawn, "- [/] a and b");
    expect(disk.get("k3.md")).toBe(`${STAMP}# K\n- [/] a and b\n`);
  });

  it("an edit typed over the row as listed writes nothing over the line the x wrote", async () => {
    const disk = vault({ "k4.md": "# K\n- [ ] a\n" });
    await x("k4.md");
    await editTodoInVault(row("k4.md"), "- [ ] a and b");
    expect(disk.get("k4.md")).toBe(`${STAMP}# K\n- [/] a\n`);
  });

  it("b puts the ⛔ on the line the x wrote", async () => {
    const disk = vault({ "k5.md": "# K\n- [ ] a\n", "o.md": "- [ ] other 🆔 kt-bbbbbb\n" });
    await x("k5.md");
    await blockTodoInVault(row("k5.md"), {
      path: "o.md",
      line: 1,
      text: "- [ ] other 🆔 kt-bbbbbb",
    });
    expect(disk.get("k5.md")).toBe(`${STAMP}# K\n- [/] a ⛔ kt-bbbbbb\n`);
  });

  it("t writes nothing over a line changed since the x landed", async () => {
    const disk = vault({ "k6.md": "# K\n- [ ] a\n" });
    await x("k6.md");
    disk.set("k6.md", `${STAMP}# K\n- [b] a 🆔 kt-aaaaaa\n`);
    await expect(toggleTimerInVault(row("k6.md"), { date: TODAY, time: "09:00" })).rejects.toThrow(
      "changed since it was listed",
    );
    expect(disk.get("k6.md")).toBe(`${STAMP}# K\n- [b] a 🆔 kt-aaaaaa\n`);
  });
});
