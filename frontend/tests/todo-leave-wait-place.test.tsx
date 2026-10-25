import { EditorView } from "@codemirror/view";
import { fireEvent } from "@testing-library/react";
import { afterEach } from "vitest";
import { cycleTodoAtCursor } from "@/lib/todo-commands";
import { patchFields, readFields } from "@/lib/todo-fields";
import { cycleLines } from "@/lib/todo-write";
import { open } from "./keybindings-fixture";
import { TODAY, UNKNOWN } from "./todo-write-fixture";

afterEach(() => {
  localStorage.removeItem("kasten.vim");
});

/** One press that names open over a note holding only this line. */
function setOpen(line: string) {
  return cycleLines({
    lines: [line],
    line: 1,
    today: TODAY,
    id: "kt-3f9a2c",
    closed: UNKNOWN,
    state: "open",
  });
}

describe("#1024 leaving waiting in the editor", () => {
  it("#1024 A1 Space s o on a waiting line whose estimate takes a 👤 keeps every other byte", () => {
    const rest = "a ⏲ 👤 2026-10-20 👤 2026-10-25";
    expect(readFields(rest)).toMatchObject({ estimate: "👤", waitingSince: "2026-10-25" });
    const { editor, doc } = open(`- [w] ${rest}`);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "s" });
    fireEvent.keyDown(editor, { key: "o" });

    expect(doc()).toBe("- [ ] a ⏲ 👤 2026-10-20");
  });

  it("#1024 A2 Space s o on a waiting line whose worked time takes a 👤 keeps every other byte", () => {
    const rest = "a ⏱ 👤 2026-10-20 👤 2026-10-25";
    expect(readFields(rest)).toMatchObject({ worked: "👤", waitingSince: "2026-10-25" });
    const { editor, doc } = open(`- [w] ${rest}`);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "s" });
    fireEvent.keyDown(editor, { key: "o" });

    expect(doc()).toBe("- [ ] a ⏱ 👤 2026-10-20");
  });

  it("#1024 A3 Space s o on a waiting line whose id takes a 👤 keeps every other byte", () => {
    const rest = "a 🆔 👤 2026-10-20 👤 2026-10-25";
    expect(readFields(rest)).toMatchObject({ id: "👤", waitingSince: "2026-10-25" });
    const { editor, doc } = open(`- [w] ${rest}`);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "s" });
    fireEvent.keyDown(editor, { key: "o" });

    expect(doc()).toBe("- [ ] a 🆔 👤 2026-10-20");
  });

  it("#1024 A4 Space s o on a waiting line whose blocker takes a 👤 keeps every other byte", () => {
    const rest = "a ⛔ 👤 2026-10-20 👤 2026-10-25";
    expect(readFields(rest)).toMatchObject({ blockedBy: ["👤"], waitingSince: "2026-10-25" });
    const { editor, doc } = open(`- [w] ${rest}`);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "s" });
    fireEvent.keyDown(editor, { key: "o" });

    expect(doc()).toBe("- [ ] a ⛔ 👤 2026-10-20");
  });
});

describe("#1024 leaving waiting in the pane", () => {
  it("#1024 A5 cycle to open on a waiting line whose estimate takes a 👤 writes the line without the wait", () => {
    const rest = "a ⏲ 👤 2026-10-20 👤 2026-10-25";
    expect(readFields(rest)).toMatchObject({ estimate: "👤", waitingSince: "2026-10-25" });

    expect(setOpen(`- [w] ${rest}`).get(1)).toBe("- [ ] a ⏲ 👤 2026-10-20");
  });

  it("#1024 A6 cycle to open on a waiting line whose worked time takes a 👤 writes the line without the wait", () => {
    const rest = "a ⏱ 👤 2026-10-20 👤 2026-10-25";
    expect(readFields(rest)).toMatchObject({ worked: "👤", waitingSince: "2026-10-25" });

    expect(setOpen(`- [w] ${rest}`).get(1)).toBe("- [ ] a ⏱ 👤 2026-10-20");
  });

  it("#1024 A7 cycle to open on a waiting line whose id takes a 👤 writes the line without the wait", () => {
    const rest = "a 🆔 👤 2026-10-20 👤 2026-10-25";
    expect(readFields(rest)).toMatchObject({ id: "👤", waitingSince: "2026-10-25" });

    expect(setOpen(`- [w] ${rest}`).get(1)).toBe("- [ ] a 🆔 👤 2026-10-20");
  });

  it("#1024 A8 cycle to open on a waiting line whose blocker takes a 👤 writes the line without the wait", () => {
    const rest = "a ⛔ 👤 2026-10-20 👤 2026-10-25";
    expect(readFields(rest)).toMatchObject({ blockedBy: ["👤"], waitingSince: "2026-10-25" });

    expect(setOpen(`- [w] ${rest}`).get(1)).toBe("- [ ] a ⛔ 👤 2026-10-20");
  });
});

describe("#1024 writing the wait over a field that holds a 👤", () => {
  it("#1024 A9 a wait written over an existing wait after an estimate that takes a 👤 changes only the wait's stamp", () => {
    const rest = "a ⏲ 👤 2026-10-20 👤 2026-10-25";

    expect(patchFields(rest, { ...readFields(rest), waitingSince: "2026-10-24" })).toBe(
      "a ⏲ 👤 2026-10-20 👤 2026-10-24",
    );
  });
});

describe("#1024 the line's other readings", () => {
  it("#1024 I3 Space s o with vim off on a waiting line whose estimate takes a 👤 writes the line without the wait", () => {
    localStorage.setItem("kasten.vim", "off");
    const { editor, doc } = open("- [w] a ⏲ 👤 2026-10-20 👤 2026-10-25");
    const view = EditorView.findFromDOM(editor) as EditorView;

    cycleTodoAtCursor(view, "open");

    expect(doc()).toBe("- [ ] a ⏲ 👤 2026-10-20");
  });

  it("#1024 I4a cycle to open on a waiting line whose wait is typed with the variation selector writes the line without the wait", () => {
    const rest = "a ⏲ 👤 2026-10-20 👤️ 2026-10-25";
    expect(readFields(rest)).toMatchObject({ estimate: "👤", waitingSince: "2026-10-25" });

    expect(setOpen(`- [w] ${rest}`).get(1)).toBe("- [ ] a ⏲ 👤 2026-10-20");
  });

  it("#1024 I4b a wait written over one typed with the variation selector keeps the selector", () => {
    const rest = "a ⏲ 👤 2026-10-20 👤️ 2026-10-25";

    expect(patchFields(rest, { ...readFields(rest), waitingSince: "2026-10-24" })).toBe(
      "a ⏲ 👤 2026-10-20 👤️ 2026-10-24",
    );
  });

  it("#1024 I5a dropping the assignee after an estimate that takes a 👤 leaves the name in the words", () => {
    const rest = "a ⏲ 👤 Bob 👤 Ada";
    expect(readFields(rest)).toMatchObject({ estimate: "👤", assignee: "Ada" });

    expect(patchFields(rest, { ...readFields(rest), assignee: undefined })).toBe("a ⏲ 👤 Bob");
  });

  it("#1024 I5b changing the assignee after an estimate that takes a 👤 writes the new name over the old", () => {
    const rest = "a ⏲ 👤 Bob 👤 Ada";
    expect(readFields(rest)).toMatchObject({ estimate: "👤", assignee: "Ada" });

    expect(patchFields(rest, { ...readFields(rest), assignee: "Eve" })).toBe("a ⏲ 👤 Bob 👤 Eve");
  });
});
