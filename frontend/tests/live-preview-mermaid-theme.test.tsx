/**
 * A diagram on screen follows the theme when the theme switches (#835).
 *
 * The package is mocked as in `mermaid-load.test.tsx`: each svg names the theme
 * the last `initialize` set, so a test can tell which theme drew it. The drawing
 * itself is in `tests/frame/mermaid.test.tsx`.
 */

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { act } from "@testing-library/react";
import { createRoot, type Root } from "react-dom/client";
import { NotePreview } from "@/components/note-preview";
import { imagePaths } from "@/lib/image";
import { livePreview } from "@/lib/live-preview";
import { drawMermaid } from "@/lib/mermaid";
import { noteLanguage } from "@/lib/note-language";
import { startTheme, toggleTheme } from "@/lib/theme";
import { vimKeys } from "@/lib/vim-mode";
import { vaultPaths } from "@/lib/wikilink";
import { stubMatchMedia } from "./match-media";

const DARK = "(prefers-color-scheme: dark)";

// Spied, so a test can read the draws a switch asked for.
vi.mock("@/lib/mermaid", { spy: true });

const { initialize, render, hold } = vi.hoisted(() => {
  let theme = "default";
  // A render in `hold.theme` waits on `hold.until`, so a test can keep a draw
  // running across a switch.
  const hold = { theme: "", until: undefined as Promise<void> | undefined };
  return {
    hold,
    initialize: vi.fn((config: { theme: string }) => {
      theme = config.theme;
    }),
    render: vi.fn(async (_id: string, source: string) => {
      const drawnIn = theme;
      if (drawnIn === hold.theme && hold.until) await hold.until;
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
  vi.mocked(drawMermaid).mockClear();
  hold.theme = "";
  hold.until = undefined;
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

function mount(doc: string, vimOn: boolean, anchor = 0): EditorView {
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

/** Waits for every draw asked for so far to land, rather than for a time. */
async function landed(): Promise<void> {
  await Promise.all(vi.mocked(drawMermaid).mock.results.map((result) => result.value));
}

/** Mounts a diagram, toggles the theme and expects the diagram to name the new one. */
async function redrawsOnToggle(source: string, vimOn: boolean): Promise<void> {
  stubMatchMedia({ [DARK]: false });
  const at = mount(note(source), vimOn);
  await vi.waitFor(() => expect(drawn(at)).toBe("default"));
  toggleTheme();
  await vi.waitFor(() => expect(drawn(at)).toBe("dark"));
}

it("#835 A1 a diagram on screen redraws in the new theme on the toggle", async () => {
  await redrawsOnToggle("graph LR\n  A1 --> B", false);
});

it("#835 A2 a diagram redraws on a system change with no choice stored", async () => {
  const system = stubMatchMedia({ [DARK]: false });
  startTheme();
  const at = mount(note("graph LR\n  A2 --> B"), false);
  await vi.waitFor(() => expect(drawn(at)).toBe("default"));

  system.set(DARK, true);
  await vi.waitFor(() => expect(drawn(at)).toBe("dark"));
});

it("#835 A4 the old drawing stays until the new one is ready", async () => {
  stubMatchMedia({ [DARK]: false });
  const at = mount(note("graph LR\n  A4 --> B"), false);
  await vi.waitFor(() => expect(drawn(at)).toBe("default"));
  const old = at.dom.querySelector(".cm-mermaid-block svg");

  let release: () => void = () => {};
  hold.theme = "dark";
  hold.until = new Promise((done) => {
    release = done;
  });
  toggleTheme();
  const during = {
    same: at.dom.querySelector(".cm-mermaid-block svg") === old,
    drawn: drawn(at),
  };

  release();
  await vi.waitFor(() => expect(drawn(at)).toBe("dark"));
  expect({ during, after: drawn(at) }).toEqual({
    during: { same: true, drawn: "default" },
    after: "dark",
  });
});

it("#835 A5 a diagram that failed to parse keeps its error in both themes", async () => {
  stubMatchMedia({ [DARK]: false });
  const source = "graph LR\n  bad -->";
  const at = mount(note(source), false);
  await vi.waitFor(() =>
    expect(at.dom.querySelector(".cm-mermaid-error")?.textContent).toBe("Parse error on line 1"),
  );

  toggleTheme();
  await landed();
  expect({
    askedDark: vi.mocked(drawMermaid).mock.calls.some(([, theme]) => theme === "dark"),
    error: at.dom.querySelector(".cm-mermaid-error")?.textContent,
    source: at.dom.querySelector(".cm-mermaid-source")?.textContent,
  }).toEqual({
    askedDark: true,
    error: "Parse error on line 1",
    source,
  });
});

it("#835 A6 a switch while a draw is running ends with the theme now set", async () => {
  stubMatchMedia({ [DARK]: false });
  const at = mount(note("graph LR\n  A6 --> B"), false);
  await vi.waitFor(() => expect(drawn(at)).toBe("default"));

  let release: () => void = () => {};
  hold.theme = "dark";
  hold.until = new Promise((done) => {
    release = done;
  });
  toggleTheme();
  toggleTheme();
  release();
  await landed();

  expect({
    shown: drawn(at),
    askedDark: vi.mocked(drawMermaid).mock.calls.some(([, theme]) => theme === "dark"),
  }).toEqual({ shown: "default", askedDark: true });
});

it("#835 A7 redraws on the toggle, vim on", async () => {
  await redrawsOnToggle("graph LR\n  A7on --> B", true);
});

it("#835 A7 redraws on the toggle, vim off", async () => {
  await redrawsOnToggle("graph LR\n  A7off --> B", false);
});

it("#835 I2 a read-only preview pane redraws on the toggle", async () => {
  stubMatchMedia({ [DARK]: false });
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  act(() => {
    root?.render(<NotePreview text={note("graph LR\n  I2 --> B")} />);
  });
  const shownIn = () => host?.querySelector(".cm-mermaid-block svg")?.getAttribute("data-theme");

  await vi.waitFor(() => expect(shownIn()).toBe("default"));
  act(() => toggleTheme());
  await vi.waitFor(() => expect(shownIn()).toBe("dark"));
});

it("#835 I3 a destroyed editor stops listening", async () => {
  stubMatchMedia({ [DARK]: false });
  const at = mount(note("graph LR\n  I3 --> B"), false);
  await vi.waitFor(() => expect(drawn(at)).toBe("default"));
  toggleTheme();
  await vi.waitFor(() => expect(drawn(at)).toBe("dark"));

  const parent = at.dom.parentElement;
  at.destroy();
  view = undefined;
  parent?.remove();
  const asked = vi.mocked(drawMermaid).mock.calls.length;
  let thrown: unknown;
  try {
    toggleTheme();
  } catch (error) {
    thrown = error;
  }
  expect({ thrown, drawsAfter: vi.mocked(drawMermaid).mock.calls.length - asked }).toEqual({
    thrown: undefined,
    drawsAfter: 0,
  });
});

it("#835 I5 a diagram showing its source during a switch draws in the new theme once the cursor leaves", async () => {
  stubMatchMedia({ [DARK]: false });
  const doc = note("graph LR\n  I5 --> B");
  const at = mount(doc, false);
  await vi.waitFor(() => expect(drawn(at)).toBe("default"));
  // The cursor inside the block, so its source shows and nothing is drawn.
  at.dispatch({ selection: { anchor: doc.indexOf("I5") } });
  toggleTheme();
  const showsSource = at.dom.querySelector(".cm-mermaid-block") === null;

  at.dispatch({ selection: { anchor: 0 } });
  await vi.waitFor(() => expect(drawn(at)).toBe("dark"));
  expect({ showsSource }).toEqual({ showsSource: true });
});

it("#835 I6 the editor measures again when the new drawing lands", async () => {
  stubMatchMedia({ [DARK]: false });
  const at = mount(note("graph LR\n  I6 --> B"), false);
  await vi.waitFor(() => expect(drawn(at)).toBe("default"));
  toggleTheme();
  const measure = vi.spyOn(at, "requestMeasure");

  await vi.waitFor(() => expect(measure).toHaveBeenCalled());
  expect({ theme: drawn(at), measured: measure.mock.calls.length > 0 }).toEqual({
    theme: "dark",
    measured: true,
  });
});
