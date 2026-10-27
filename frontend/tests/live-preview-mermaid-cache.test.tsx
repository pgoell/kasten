/**
 * A diagram on screen keeps its drawing past the cache's bound (#838).
 *
 * The cache keeps the 32 most recent drawings that no block holds. The mermaid
 * module cache is shared by every test in this file, so each test draws its own
 * sources. Each "kept" test also draws an old source first and checks that it
 * is drawn again, so a cache that never evicts fails the test.
 */

import { history, undo } from "@codemirror/commands";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { act } from "@testing-library/react";
import { createRoot, type Root } from "react-dom/client";
import { NotePreview } from "@/components/note-preview";
import { imagePaths } from "@/lib/image";
import { livePreview } from "@/lib/live/live-preview";
import { drawMermaid, drawnMermaid } from "@/lib/live/mermaid";
import { noteLanguage } from "@/lib/note-language";
import { toggleTheme } from "@/lib/theme";
import { vimKeys } from "@/lib/vim-mode";
import { vaultPaths } from "@/lib/wikilink";
import { stubMatchMedia } from "./match-media";

const DARK = "(prefers-color-scheme: dark)";

const { initialize, render } = vi.hoisted(() => {
  let theme = "default";
  return {
    initialize: vi.fn((config: { theme: string }) => {
      theme = config.theme;
    }),
    render: vi.fn(async (_id: string, source: string) => {
      const drawnIn = theme;
      if (source.includes("bad")) throw new Error("Parse error on line 1");
      return { svg: `<svg data-theme="${drawnIn}" aria-label="${source}"></svg>` };
    }),
  };
});

vi.mock("mermaid", () => ({ default: { initialize, render } }));

let view: EditorView | undefined;
let root: Root | undefined;
let host: HTMLElement | undefined;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  view?.dom.parentElement?.remove();
  view?.destroy();
  view = undefined;
  act(() => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
});

function mount(doc: string, vimOn: boolean, anchor = 0, extra: Extension[] = []): EditorView {
  const parent = document.body.appendChild(document.createElement("div"));
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor },
      extensions: [
        noteLanguage(),
        vimOn ? vim() : vimKeys.of(false),
        livePreview(),
        vaultPaths.of([]),
        imagePaths.of([]),
        ...extra,
      ],
    }),
    parent,
  });
  return view;
}

/** A note of one diagram between two lines of prose. */
function note(source: string): string {
  return ["before", "", "```mermaid", source, "```", "", "after"].join("\n");
}

/** The theme the diagram on screen was drawn in, as mermaid names it. */
function drawn(at: EditorView): string | null {
  return at.dom.querySelector(".cm-mermaid-block svg")?.getAttribute("data-theme") ?? null;
}

/** The source the diagram on screen was drawn from. */
function shown(at: EditorView): string | null {
  return at.dom.querySelector(".cm-mermaid-block svg")?.getAttribute("aria-label") ?? null;
}

/** How many times mermaid was asked to draw `source`, in any theme. */
function rendersOf(source: string): number {
  return render.mock.calls.filter(([, s]) => s === source).length;
}

/**
 * Draws `count` sources that no block shows, one after another. RECENT in
 * `mermaid.ts` is 32, so 33 unheld drawings push the oldest out. The tests pass 33.
 */
async function drawOthers(tag: string, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await drawMermaid(`graph LR\n  ${tag}n${i} --> B`, "light");
  }
}

/** A diagram on screen keeps its drawing while 33 others are drawn past it. */
async function keepsPastOthers(tag: string, vimOn: boolean): Promise<void> {
  stubMatchMedia({ [DARK]: false });
  const source = `graph LR\n  ${tag}keep --> B`;
  const old = `graph LR\n  ${tag}old --> B`;
  await drawMermaid(old, "light");
  const at = mount(note(source), vimOn);
  await vi.waitFor(() => expect(drawn(at)).toBe("default"));
  await drawOthers(tag, 33);
  await drawMermaid(old, "light");
  expect({
    kept: drawnMermaid(source, "light") !== undefined,
    oldRenders: rendersOf(old),
  }).toEqual({ kept: true, oldRenders: 2 });
}

it("#838 A2 a diagram on screen keeps its drawing past 32 others", async () => {
  await keepsPastOthers("A2", false);
});

it("#838 A3 an undo right after an edit brings the old drawing back with no new render", async () => {
  stubMatchMedia({ [DARK]: false });
  const old = "graph LR\n  A3old --> B";
  const x = "graph LR\n  A3x --> B";
  const y = "graph LR\n  A3y --> B";
  await drawMermaid(old, "light");
  const doc = note(x);
  const at = mount(doc, false, 0, [history()]);
  await vi.waitFor(() => expect(shown(at)).toBe(x));
  await drawOthers("A3", 33);
  // Edits the source to Y with the cursor outside the block, then undoes it.
  const from = doc.indexOf("A3x");
  at.dispatch({ changes: { from, to: from + 3, insert: "A3y" } });
  await vi.waitFor(() => expect(shown(at)).toBe(y));
  undo(at);
  const undone = shown(at);
  await drawMermaid(old, "light");
  expect({
    undone,
    xRenders: rendersOf(x),
    oldRenders: rendersOf(old),
  }).toEqual({ undone: x, xRenders: 1, oldRenders: 2 });
});

it("#838 A4 a switch and back right after shows the first theme at once with no new render", async () => {
  stubMatchMedia({ [DARK]: false });
  const source = "graph LR\n  A4keep --> B";
  const old = "graph LR\n  A4old --> B";
  await drawMermaid(old, "light");
  const at = mount(note(source), false);
  await vi.waitFor(() => expect(drawn(at)).toBe("default"));
  await drawOthers("A4", 33);
  toggleTheme();
  await vi.waitFor(() => expect(drawn(at)).toBe("dark"));
  const before = rendersOf(source);
  toggleTheme();
  const shownNow = drawn(at);
  // Awaited, so a draw the cache missed has been asked for before it is counted.
  await drawMermaid(source, "light");
  const newRenders = rendersOf(source) - before;
  await drawMermaid(old, "light");
  expect({
    shown: shownNow,
    newRenders,
    oldRenders: rendersOf(old),
  }).toEqual({ shown: "default", newRenders: 0, oldRenders: 2 });
});

it("#838 A5 a diagram on screen that failed to parse keeps its error past 32 others", async () => {
  stubMatchMedia({ [DARK]: false });
  const bad = "graph LR\n  A5 bad -->";
  const old = "graph LR\n  A5old --> B";
  await drawMermaid(old, "light");
  const at = mount(note(bad), false);
  await vi.waitFor(() =>
    expect(at.dom.querySelector(".cm-mermaid-error")?.textContent).toBe("Parse error on line 1"),
  );
  await drawOthers("A5", 33);
  await drawMermaid(old, "light");
  expect({
    error: at.dom.querySelector(".cm-mermaid-error")?.textContent,
    kept: drawnMermaid(bad, "light") !== undefined,
    oldRenders: rendersOf(old),
  }).toEqual({ error: "Parse error on line 1", kept: true, oldRenders: 2 });
});

it("#838 A6 kept past 32 others, vim on", async () => {
  await keepsPastOthers("A6on", true);
});

it("#838 A6 kept past 32 others, vim off", async () => {
  await keepsPastOthers("A6off", false);
});

it("#838 I1 a destroyed editor lets go of its drawing", async () => {
  stubMatchMedia({ [DARK]: false });
  const source = "graph LR\n  I1keep --> B";
  const at = mount(note(source), false);
  await vi.waitFor(() => expect(drawn(at)).toBe("default"));
  const parent = at.dom.parentElement;
  at.destroy();
  view = undefined;
  parent?.remove();
  await drawOthers("I1", 33);
  expect({ kept: drawnMermaid(source, "light") !== undefined }).toEqual({ kept: false });
});

it("#838 I2 two blocks of one source: one leaving keeps the other's drawing", async () => {
  stubMatchMedia({ [DARK]: false });
  const source = "graph LR\n  I2keep --> B";
  const old = "graph LR\n  I2old --> B";
  await drawMermaid(old, "light");
  const doc = [
    "before",
    "",
    "```mermaid",
    source,
    "```",
    "",
    "```mermaid",
    source,
    "```",
    "",
    "after",
  ].join("\n");
  const at = mount(doc, false);
  await vi.waitFor(() => expect(at.dom.querySelectorAll(".cm-mermaid-block svg")).toHaveLength(2));
  // Deletes the first block, from its opening fence up to the second one's.
  const first = doc.indexOf("```mermaid");
  const second = doc.indexOf("```mermaid", first + 1);
  at.dispatch({ changes: { from: first, to: second } });
  await drawOthers("I2", 33);
  await drawMermaid(old, "light");
  expect({
    blocks: at.dom.querySelectorAll(".cm-mermaid-block svg").length,
    kept: drawnMermaid(source, "light") !== undefined,
    oldRenders: rendersOf(old),
  }).toEqual({ blocks: 1, kept: true, oldRenders: 2 });
});

it("#838 I5 a read-only preview pane keeps its diagram past 32 others", async () => {
  stubMatchMedia({ [DARK]: false });
  const source = "graph LR\n  I5keep --> B";
  const old = "graph LR\n  I5old --> B";
  await drawMermaid(old, "light");
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  act(() => {
    root?.render(<NotePreview text={note(source)} />);
  });
  await vi.waitFor(() => expect(host?.querySelector(".cm-mermaid-block svg")).not.toBeNull());
  await drawOthers("I5", 33);
  await drawMermaid(old, "light");
  expect({
    kept: drawnMermaid(source, "light") !== undefined,
    oldRenders: rendersOf(old),
  }).toEqual({ kept: true, oldRenders: 2 });
});
