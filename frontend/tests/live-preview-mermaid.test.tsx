/**
 * Mermaid loads only for a note that has a diagram in it (#423).
 *
 * The package is mocked, so this reads whether the dynamic import ran rather
 * than what it drew; the drawing is in `tests/frame/mermaid.test.tsx`.
 */

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { vimKeys } from "@/lib/editor/vim-mode";
import { imagePaths } from "@/lib/image";
import { livePreview } from "@/lib/live/live-preview";
import { noteLanguage } from "@/lib/note-language";
import { vaultPaths } from "@/lib/wikilink";

const { loaded, render } = vi.hoisted(() => ({
  loaded: vi.fn(),
  render: vi.fn(async () => ({ svg: "<svg></svg>" })),
}));

// The factory runs when the module is first imported, which is the dynamic
// import in `mermaid.ts`, so `loaded` counts the loads.
vi.mock("mermaid", () => {
  loaded();
  return { default: { initialize: vi.fn(), render } };
});

let view: EditorView | undefined;

afterEach(() => {
  view?.dom.parentElement?.remove();
  view?.destroy();
  view = undefined;
});

function mount(doc: string): EditorView {
  const parent = document.body.appendChild(document.createElement("div"));
  view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        noteLanguage(),
        vimKeys.of(false),
        livePreview(),
        vaultPaths.of([]),
        imagePaths.of([]),
      ],
    }),
    parent,
  });
  return view;
}

// First, because the load it waits not to see is one the test after it makes.
it("A8 never loads mermaid for a note without a diagram", async () => {
  const at = mount("before\n\n```js\nconst x = 1;\n```\n\nafter `code` here");
  // The note drawn, its other fence and all, which is when a load would start.
  await vi.waitFor(() => expect(at.dom.querySelector(".cm-code-block")).not.toBeNull());

  expect(loaded).not.toHaveBeenCalled();
  expect(render).not.toHaveBeenCalled();
});

it("A8 loads mermaid for a note with a diagram, whatever the case of its name", async () => {
  mount("before\n\n```Mermaid\nflowchart TD\n  A --> B\n```");

  await vi.waitFor(() =>
    expect(render).toHaveBeenCalledWith(
      expect.stringMatching(/^kasten-mermaid-\d+$/),
      "flowchart TD\n  A --> B",
    ),
  );
  expect(loaded).toHaveBeenCalledTimes(1);
});
