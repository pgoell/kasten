/**
 * A failed mermaid load is tried again by the next diagram (#647).
 *
 * The package is mocked, as in `live-preview-mermaid.test.tsx`; the drawing
 * itself is in `tests/frame/mermaid.test.tsx`.
 */

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { imagePaths } from "@/lib/image";
import { livePreview } from "@/lib/live/live-preview";
import { drawMermaid, drawnMermaid } from "@/lib/live/mermaid";
import { noteLanguage } from "@/lib/note-language";
import { vimKeys } from "@/lib/vim-mode";
import { vaultPaths } from "@/lib/wikilink";

// Spied, so a test can wait on the drawing a widget asked for.
vi.mock("@/lib/live/mermaid", { spy: true });

/** Whether the next fetch of mermaid fails, the way a chunk does while offline. */
const network = vi.hoisted(() => ({ down: false }));

const { loaded, render } = vi.hoisted(() => ({
  loaded: vi.fn(),
  // Each svg names its source, so a test can tell which diagram drew.
  render: vi.fn(async (_id: string, source: string) => {
    if (source.includes("bad")) throw new Error("Parse error on line 1");
    return { svg: `<svg aria-label="${source}"></svg>` };
  }),
}));

// A factory that throws is not cached, so the next import runs it again: the
// shape of a chunk fetch that failed once and may succeed when asked again.
vi.mock("mermaid", () => {
  if (network.down) throw new TypeError("Failed to fetch dynamically imported module");
  loaded();
  return { default: { initialize: vi.fn(), render } };
});

let view: EditorView | undefined;

beforeEach(() => {
  vi.mocked(drawMermaid).mockClear();
});
afterEach(() => {
  network.down = false;
  view?.dom.parentElement?.remove();
  view?.destroy();
  view = undefined;
});

function mount(doc: string): EditorView {
  view?.dom.parentElement?.remove();
  view?.destroy();
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

/** A note of one diagram per source, the cursor above them all. */
function note(...sources: string[]): string {
  return ["before", ...sources.map((source) => `\`\`\`mermaid\n${source}\n\`\`\``)].join("\n\n");
}

/** What every diagram block shows: the source its svg names, or its error. */
function shown(at: EditorView): string[] {
  return [...at.dom.querySelectorAll(".cm-mermaid-block")].map(
    (block) =>
      block.querySelector("svg")?.getAttribute("aria-label") ??
      `error: ${block.querySelector(".cm-mermaid-error")?.textContent}`,
  );
}

/** Wait for every drawing asked for so far to land, rather than for a time. */
async function landed(): Promise<void> {
  await Promise.all(vi.mocked(drawMermaid).mock.results.map((result) => result.value));
}

// In this order: a load that succeeds is kept for the rest of the file, so the
// tests that need a load to fail run before the ones that end in a draw.
it("#647 I5 a failed load shows the error beside the source and logs no unhandled rejection", async () => {
  const unhandled: unknown[] = [];
  const listen = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", listen);
  try {
    network.down = true;
    const at = mount(note("graph LR\n  I5 --> B"));
    await vi.waitFor(() => expect(vi.mocked(drawMermaid)).toHaveBeenCalled());
    await landed();
    // Node reports a rejection nobody handled once the microtasks drain.
    await new Promise((done) => setTimeout(done, 0));

    expect({
      error: at.dom.querySelector(".cm-mermaid-error")?.textContent,
      source: at.dom.querySelector(".cm-mermaid-source")?.textContent,
      // Not kept as the diagram's drawing, so the next widget asks again.
      kept: drawnMermaid("graph LR\n  I5 --> B"),
      unhandled,
    }).toEqual({
      // Any message: vitest wraps the factory's error in one of its own.
      error: expect.stringMatching(/./),
      source: "graph LR\n  I5 --> B",
      kept: undefined,
      unhandled: [],
    });
  } finally {
    process.off("unhandledRejection", listen);
  }
});

it("#647 A2 after a failed load the same diagram and another load again and draw, no reload", async () => {
  network.down = true;
  const first = mount(note("graph LR\n  A2 --> B"));
  await vi.waitFor(() => expect(vi.mocked(drawMermaid)).toHaveBeenCalled());
  await landed();
  expect.soft(shown(first)).toEqual([expect.stringMatching(/^error: ./)]);

  network.down = false;
  const at = mount(note("graph LR\n  A2 --> B", "graph LR\n  A2 --> C"));

  await vi.waitFor(() =>
    expect({ shown: shown(at), loaded: loaded.mock.calls.length }).toEqual({
      shown: ["graph LR\n  A2 --> B", "graph LR\n  A2 --> C"],
      loaded: 1,
    }),
  );
});

it("#647 I4 a diagram with a syntax error still shows its error, kept, with no new load", async () => {
  const bad = "graph LR\n  bad -->";
  mount(note(bad));
  await vi.waitFor(() => expect(vi.mocked(drawMermaid)).toHaveBeenCalled());
  await landed();
  render.mockClear();
  loaded.mockClear();

  // A second note with the same diagram shows the kept error at once.
  const at = mount(note(bad));

  expect({
    shown: shown(at),
    source: at.dom.querySelector(".cm-mermaid-source")?.textContent,
    rendered: render.mock.calls.length,
    loaded: loaded.mock.calls.length,
  }).toEqual({
    shown: ["error: Parse error on line 1"],
    source: bad,
    rendered: 0,
    loaded: 0,
  });
});
