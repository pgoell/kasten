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

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
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

vi.mock("@/lib/trash-api", async (original) => ({
  ...(await original<typeof import("@/lib/trash-api")>()),
  fetchTrash: async () => [],
}));

vi.mock("@/lib/graph-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/graph-api")>()),
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
    expect(cursorLine(viewOf(host))).toBe("# Reader");

    await userEvent.keyboard("k");

    expect(visibleEditor(host).textContent).toContain("type: Concept");
    expect(cursorLine(viewOf(host))).toBe("---");
  } finally {
    await unmount(mounted);
  }
}, 60_000);

it("with vim on, dk from the first body line deletes only the fence and that line", async () => {
  const mounted = await mountNote(DESKTOP, "light");
  try {
    const { host } = mounted;
    visibleEditor(host).focus();
    const before = viewOf(host).state.doc.toString();
    const lines = before.split("\n");
    // Index 6 is the closing fence, index 7 the `# Reader` line under it.
    expect(lines[6]).toBe("---");
    expect(lines[7]).toBe("# Reader");

    await userEvent.keyboard("d");
    await userEvent.keyboard("k");

    expect(viewOf(host).state.doc.toString()).toBe(
      lines.filter((_, index) => index !== 6 && index !== 7).join("\n"),
    );
    expect(visibleEditor(host).textContent).toContain("type: Concept");

    await userEvent.keyboard("u");
    expect(viewOf(host).state.doc.toString()).toBe(before);
  } finally {
    await unmount(mounted);
  }
}, 60_000);
