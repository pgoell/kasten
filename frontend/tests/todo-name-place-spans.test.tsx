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

describe("#1018 the name place past a span in the editor", () => {
  it("#1018 A1 Space s w past a code span holding the stamp puts the cursor after the stamp it wrote", () => {
    const { editor, doc } = open(`- [ ] see \`👤 ${TODAY} x\` x`);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "s" });
    fireEvent.keyDown(editor, { key: "w" });

    const stamped = `- [w] see \`👤 ${TODAY} x\` x 👤 ${TODAY}`;
    expect(doc()).toBe(stamped);
    const view = EditorView.findFromDOM(editor) as EditorView;
    expect(view.state.selection.main.head).toBe(stamped.length - 1);
  });

  it("#1018 A3 Space s w past a markdown link holding the stamp puts the cursor after the stamp it wrote", () => {
    const { editor, doc } = open(`- [ ] see [👤 ${TODAY} x](x) x`);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "s" });
    fireEvent.keyDown(editor, { key: "w" });

    const stamped = `- [w] see [👤 ${TODAY} x](x) x 👤 ${TODAY}`;
    expect(doc()).toBe(stamped);
    const view = EditorView.findFromDOM(editor) as EditorView;
    expect(view.state.selection.main.head).toBe(stamped.length - 1);
  });

  it("#1018 A5 Space s w past a wikilink holding the stamp puts the cursor after the stamp it wrote", () => {
    const { editor, doc } = open(`- [ ] see [[👤 ${TODAY} x]] x`);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "s" });
    fireEvent.keyDown(editor, { key: "w" });

    const stamped = `- [w] see [[👤 ${TODAY} x]] x 👤 ${TODAY}`;
    expect(doc()).toBe(stamped);
    const view = EditorView.findFromDOM(editor) as EditorView;
    expect(view.state.selection.main.head).toBe(stamped.length - 1);
  });
});

describe("#1018 the name place past a span in the pane", () => {
  it("#1018 A2 the pane opens the edit past a code span holding the stamp with the cursor after the stamp", async () => {
    const line = "- [w] see `👤 2026-10-25 x` x 👤 2026-10-25";
    const pane = renderPane([{ path: "a.md", line: 1, text: line }]);
    await pane.loaded();
    expect(pane.rows()).toHaveLength(1);

    pane.press("i");

    const input = (await screen.findByLabelText("edit line")) as HTMLInputElement;
    expect(input.value).toBe(line);
    await waitFor(() => expect(input.selectionStart).toBe(line.length));
  });

  it("#1018 A4 the pane opens the edit past a markdown link holding the stamp with the cursor after the stamp", async () => {
    const line = "- [w] see [👤 2026-10-25 x](x) x 👤 2026-10-25";
    const pane = renderPane([{ path: "a.md", line: 1, text: line }]);
    await pane.loaded();
    expect(pane.rows()).toHaveLength(1);

    pane.press("i");

    const input = (await screen.findByLabelText("edit line")) as HTMLInputElement;
    expect(input.value).toBe(line);
    await waitFor(() => expect(input.selectionStart).toBe(line.length));
  });

  it("#1018 A6 the pane opens the edit past a wikilink holding the stamp with the cursor after the stamp", async () => {
    const line = "- [w] see [[👤 2026-10-25 x]] x 👤 2026-10-25";
    const pane = renderPane([{ path: "a.md", line: 1, text: line }]);
    await pane.loaded();
    expect(pane.rows()).toHaveLength(1);

    pane.press("i");

    const input = (await screen.findByLabelText("edit line")) as HTMLInputElement;
    expect(input.value).toBe(line);
    await waitFor(() => expect(input.selectionStart).toBe(line.length));
  });
});

describe("#1018 the name place is read off the line with spans blanked", () => {
  it("#1018 I1 nameAt skips a code span holding the stamp", () => {
    const line = "- [w] see `👤 2026-10-25 x` x 👤 2026-10-25";

    expect(nameAt(line)).toBe(line.length);
  });

  it("#1018 I1 nameAt skips a markdown link holding the stamp", () => {
    const line = "- [w] see [👤 2026-10-25 x](x) x 👤 2026-10-25";

    expect(nameAt(line)).toBe(line.length);
  });

  it("#1018 I1 nameAt skips a wikilink holding the stamp", () => {
    const line = "- [w] see [[👤 2026-10-25 x]] x 👤 2026-10-25";

    expect(nameAt(line)).toBe(line.length);
  });

  it("#1018 I1 nameAt skips an HTML comment holding the stamp", () => {
    const line = "- [w] see <!-- 👤 2026-10-25 --> x 👤 2026-10-25";

    expect(nameAt(line)).toBe(line.length);
  });

  it("#1018 I2 nameAt skips a span ahead of a stamp typed with the variation selector", () => {
    const line = "- [w] see `👤 2026-10-25 x` x 👤️ 2026-10-25";

    expect(nameAt(line)).toBe(line.length);
  });
});

describe("#1018 the name place with vim off and by touch", () => {
  it("#1018 I3 set waiting with vim off past a code span puts the cursor after the stamp it wrote", () => {
    localStorage.setItem("kasten.vim", "off");
    const { editor, doc } = open(`- [ ] see \`👤 ${TODAY} x\` x`);
    const view = EditorView.findFromDOM(editor) as EditorView;

    cycleTodoAtCursor(view, "waiting");

    const stamped = `- [w] see \`👤 ${TODAY} x\` x 👤 ${TODAY}`;
    expect(doc()).toBe(stamped);
    expect(view.state.selection.main.head).toBe(stamped.length - 1);
  });

  it("#1018 I4 by touch, edit on a waiting row past a code span puts the cursor after the stamp", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const line = "- [w] see `👤 2026-10-25 x` x 👤 2026-10-25";
    const name = "see `👤 2026-10-25 x` x";
    renderPane([{ path: "a.md", line: 1, text: line }]);
    await waitFor(() => expect(screen.getByLabelText(`more for ${name}`)).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(`more for ${name}`));
    fireEvent.click(screen.getByLabelText(`edit ${name}`));

    const input = (await screen.findByLabelText("edit line")) as HTMLInputElement;
    expect(input.value).toBe(line);
    await waitFor(() => expect(input.selectionStart).toBe(line.length));
  });
});
