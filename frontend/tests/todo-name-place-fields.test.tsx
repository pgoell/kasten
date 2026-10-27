import { EditorView } from "@codemirror/view";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { nameAt } from "@/lib/todo";
import { cycleTodoAtCursor } from "@/lib/todo-commands";
import { open, TODAY } from "./keybindings-fixture";
import { COARSE, NARROW, stubMatchMedia } from "./match-media";
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

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.removeItem("kasten.vim");
});

describe("#1021 the name place in the editor", () => {
  it("#1021 A1 Space s w with an estimate that takes the 👤 puts the cursor after the wait stamp it wrote", () => {
    const { editor, doc } = open(`- [ ] a ⏲ 👤 ${TODAY}`);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "s" });
    fireEvent.keyDown(editor, { key: "w" });

    const stamped = `- [w] a 👤 ${TODAY} ⏲ 👤 ${TODAY}`;
    expect(doc()).toBe(stamped);
    const view = EditorView.findFromDOM(editor) as EditorView;
    expect(view.state.selection.main.head).toBe(`- [w] a 👤 ${TODAY}`.length - 1);
  });

  it("#1021 A2 Space s w with a worked time that takes the 👤 puts the cursor after the wait stamp it wrote", () => {
    const { editor, doc } = open(`- [ ] a ⏱ 👤 ${TODAY}`);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "s" });
    fireEvent.keyDown(editor, { key: "w" });

    const stamped = `- [w] a 👤 ${TODAY} ⏱ 👤 ${TODAY}`;
    expect(doc()).toBe(stamped);
    const view = EditorView.findFromDOM(editor) as EditorView;
    expect(view.state.selection.main.head).toBe(`- [w] a 👤 ${TODAY}`.length - 1);
  });

  it("#1021 A3 Space s w with an id that takes the 👤 puts the cursor after the wait stamp it wrote", () => {
    const { editor, doc } = open(`- [ ] a 🆔 👤 ${TODAY}`);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "s" });
    fireEvent.keyDown(editor, { key: "w" });

    const stamped = `- [w] a 👤 ${TODAY} 🆔 👤 ${TODAY}`;
    expect(doc()).toBe(stamped);
    const view = EditorView.findFromDOM(editor) as EditorView;
    expect(view.state.selection.main.head).toBe(`- [w] a 👤 ${TODAY}`.length - 1);
  });

  it("#1021 A4 Space s w with a blocker that takes the 👤 puts the cursor after the wait stamp it wrote", () => {
    const { editor, doc } = open(`- [ ] a ⛔ 👤 ${TODAY}`);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "s" });
    fireEvent.keyDown(editor, { key: "w" });

    const stamped = `- [w] a 👤 ${TODAY} ⛔ 👤 ${TODAY}`;
    expect(doc()).toBe(stamped);
    const view = EditorView.findFromDOM(editor) as EditorView;
    expect(view.state.selection.main.head).toBe(`- [w] a 👤 ${TODAY}`.length - 1);
  });
});

describe("#1021 the name place in the pane", () => {
  it("#1021 A5 the pane i on a waiting row with an estimate that takes the 👤 puts the cursor after the wait stamp", async () => {
    const line = "- [w] a ⏲ 👤 2026-10-25 👤 2026-10-25";
    const pane = renderPane([{ path: "a.md", line: 1, text: line }]);
    await pane.loaded();
    expect(pane.rows()).toHaveLength(1);

    pane.press("i");

    const input = (await screen.findByLabelText("edit line")) as HTMLInputElement;
    expect(input.value).toBe(line);
    await waitFor(() => expect(input.selectionStart).toBe(line.length));
  });

  it("#1021 A6 the pane i on a waiting row with a worked time that takes the 👤 puts the cursor after the wait stamp", async () => {
    const line = "- [w] a ⏱ 👤 2026-10-25 👤 2026-10-25";
    const pane = renderPane([{ path: "a.md", line: 1, text: line }]);
    await pane.loaded();
    expect(pane.rows()).toHaveLength(1);

    pane.press("i");

    const input = (await screen.findByLabelText("edit line")) as HTMLInputElement;
    expect(input.value).toBe(line);
    await waitFor(() => expect(input.selectionStart).toBe(line.length));
  });

  it("#1021 A7 the pane i on a waiting row with an id that takes the 👤 puts the cursor after the wait stamp", async () => {
    const line = "- [w] a 🆔 👤 2026-10-25 👤 2026-10-25";
    const pane = renderPane([{ path: "a.md", line: 1, text: line }]);
    await pane.loaded();
    expect(pane.rows()).toHaveLength(1);

    pane.press("i");

    const input = (await screen.findByLabelText("edit line")) as HTMLInputElement;
    expect(input.value).toBe(line);
    await waitFor(() => expect(input.selectionStart).toBe(line.length));
  });

  it("#1021 A8 the pane i on a waiting row with a blocker that takes the 👤 puts the cursor after the wait stamp", async () => {
    const line = "- [w] a ⛔ 👤 2026-10-25 👤 2026-10-25";
    const pane = renderPane([{ path: "a.md", line: 1, text: line }]);
    await pane.loaded();
    expect(pane.rows()).toHaveLength(1);

    pane.press("i");

    const input = (await screen.findByLabelText("edit line")) as HTMLInputElement;
    expect(input.value).toBe(line);
    await waitFor(() => expect(input.selectionStart).toBe(line.length));
  });
});

describe("#1021 nameAt on the line", () => {
  it("#1021 I3 nameAt with a due date ahead of the estimate reads the wait at the line end", () => {
    const line = "- [w] a 📅 2026-10-30 ⏲ 👤 2026-10-25 👤 2026-10-25";

    expect(nameAt(line)).toBe(line.length);
  });

  it("#1021 I4 nameAt after a 👤 typed with the variation selector reads the wait at the line end", () => {
    const line = "- [w] a ⏲ 👤 2026-10-25 👤️ 2026-10-25";

    expect(nameAt(line)).toBe(line.length);
  });
});

describe("#1021 the name place with vim off and by touch", () => {
  it("#1021 I5 set waiting with vim off after an estimate that takes the 👤 puts the cursor after the stamp it wrote", () => {
    localStorage.setItem("kasten.vim", "off");
    const { editor, doc } = open(`- [ ] a ⏲ 👤 ${TODAY}`);
    const view = EditorView.findFromDOM(editor) as EditorView;

    cycleTodoAtCursor(view, "waiting");

    const stamped = `- [w] a 👤 ${TODAY} ⏲ 👤 ${TODAY}`;
    expect(doc()).toBe(stamped);
    expect(view.state.selection.main.head).toBe(`- [w] a 👤 ${TODAY}`.length - 1);
  });

  it("#1021 I6 by touch edit on a waiting row with an estimate that takes the 👤 puts the cursor after the wait stamp", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const line = "- [w] a ⏲ 👤 2026-10-25 👤 2026-10-25";
    const name = "a 2026-10-25";
    const pane = renderPane([{ path: "a.md", line: 1, text: line }]);
    await pane.loaded();
    expect(screen.getByLabelText(`more for ${name}`)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(`more for ${name}`));
    fireEvent.click(screen.getByLabelText(`edit ${name}`));

    const input = (await screen.findByLabelText("edit line")) as HTMLInputElement;
    expect(input.value).toBe(line);
    await waitFor(() => expect(input.selectionStart).toBe(line.length));
  });
});
