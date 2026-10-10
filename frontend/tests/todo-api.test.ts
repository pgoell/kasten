import { addSubtaskInVault, addTodoInVault, editTodoInVault } from "@/lib/todo-api";

// Standing in for the module rather than for `fetch`, the way the pane's tests
// do: what this half owns is which notes it reads and what it sends back.
const { createNote, fetchNote, saveNote } = vi.hoisted(() => ({
  createNote: vi.fn(),
  fetchNote: vi.fn(),
  saveNote: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ createNote, fetchNote, saveNote }));

beforeEach(() => {
  createNote.mockReset();
  createNote.mockResolvedValue(undefined);
  fetchNote.mockReset();
  saveNote.mockReset();
  saveNote.mockResolvedValue(undefined);
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
    await addTodoInVault("call the dentist", "2026-08-06", []);

    const [, text] = createNote.mock.calls[0] as [string, string];
    expect(text.split("\n").slice(0, 3)).toEqual(["---", "type: Periodic Note", "---"]);
  });
});
