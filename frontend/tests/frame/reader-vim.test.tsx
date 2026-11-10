/**
 * Vim on the reader's note, where Read hides the frontmatter behind Properties.
 * The cursor opens on the first body line, below the fence, so the first key
 * up is the one that reaches the block.
 */

import { EditorView } from "@codemirror/view";
import { userEvent } from "vitest/browser";
import {
  DESKTOP,
  mountNote,
  need,
  registerReaderFixture,
  unmount,
  visibleEditor,
} from "./reader-fixture";

vi.mock("@/lib/core/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/core/api")>();
  return {
    ...real,
    fetchFiles: vi.fn(),
    fetchNote: vi.fn(),
    saveNote: async (path: string, content: string) => ({ path, content }),
    searchNotes: vi.fn(),
    fetchTodos: vi.fn(),
    fetchImages: async () => [],
    fetchHtml: async () => [],
    fetchAssets: async () => [],
    fetchTags: async () => [],
    fetchTerminals: async () => [],
    fetchVersion: async () => "0.8.0",
    fetchWeather: async () => [],
  };
});

vi.mock("@/lib/vault/move/trash-api", async (original) => ({
  ...(await original<typeof import("@/lib/vault/move/trash-api")>()),
  fetchTrash: async () => [],
}));

vi.mock("@/lib/graph/graph-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/graph/graph-api")>()),
  fetchGraph: vi.fn(),
}));

registerReaderFixture();

/** The CodeMirror view of the editor on screen. */
function viewOf(host: HTMLElement): EditorView {
  const editor = need(visibleEditor(host).closest<HTMLElement>(".cm-editor"), "editor element");
  return need(EditorView.findFromDOM(editor), "editor view");
}

/** The text of the line the cursor is on. */
function cursorLine(view: EditorView): string {
  return view.state.doc.lineAt(view.state.selection.main.head).text;
}

it("with vim on, k from the first body line shows the YAML", async () => {
  const mounted = await mountNote(DESKTOP, "light");
  try {
    const { host } = mounted;
    visibleEditor(host).focus();
    // The note opens past the blank line and the heading that repeats its title, and k steps
    // over those, as they have no height.
    expect(cursorLine(viewOf(host))).toBe("about:: [[Design Notes]]");

    await userEvent.keyboard("k");

    expect(visibleEditor(host).textContent).toContain("type: Concept");
    expect(cursorLine(viewOf(host))).toBe("---");
  } finally {
    await unmount(mounted);
  }
}, 60_000);

it("with vim on, dk from the first line of text deletes the fence, the lines Read hides, and that line", async () => {
  const mounted = await mountNote(DESKTOP, "light");
  try {
    const { host } = mounted;
    visibleEditor(host).focus();
    const before = viewOf(host).state.doc.toString();
    const lines = before.split("\n");
    // Index 6 is the closing fence; 7 and 8, the title heading and a blank line, have no height.
    expect(lines[6]).toBe("---");
    expect(lines[7]).toBe("# Reader");
    expect(cursorLine(viewOf(host))).toBe(lines[9]);

    await userEvent.keyboard("d");
    await userEvent.keyboard("k");

    expect(viewOf(host).state.doc.toString()).toBe(
      lines.filter((_, index) => index < 6 || index > 9).join("\n"),
    );
    expect(visibleEditor(host).textContent).toContain("type: Concept");

    await userEvent.keyboard("u");
    expect(viewOf(host).state.doc.toString()).toBe(before);
  } finally {
    await unmount(mounted);
  }
}, 60_000);
