/// <reference types="node" />

import { readFileSync } from "node:fs";
import { undo } from "@codemirror/commands";
import { forceParsing } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act, fireEvent, type RenderResult, render, waitFor } from "@testing-library/react";
import { Editor } from "@/components/editor";
import { NotePreview } from "@/components/note-preview";
import { kastenTheme } from "@/lib/editor-theme";
import { renderedMarkdown } from "@/lib/live-preview";
import { loadKatex } from "@/lib/math";
import { noteLanguage } from "@/lib/note-language";

// Spied rather than replaced, so KaTeX still draws and a test can also ask
// whether it was loaded at all.
vi.mock("@/lib/math", { spy: true });

function content(container: HTMLElement): string {
  return (container.querySelector(".cm-content") as HTMLElement).textContent ?? "";
}

function viewIn(container: HTMLElement): EditorView {
  return EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement) as EditorView;
}

/** An `Editor` with vim on or off for certain, its note parsed to the end (#365). */
function editor(doc: string, vimOn: boolean): RenderResult {
  localStorage.setItem("kasten.vim", vimOn ? "on" : "off");
  const result = render(<Editor initialDoc={doc} />);
  const view = viewIn(result.container);
  act(() => {
    forceParsing(view, view.state.doc.length, 5000);
  });
  return result;
}

function keys(container: HTMLElement, ...pressed: string[]): void {
  const editor = container.querySelector(".cm-content") as HTMLElement;
  for (const key of pressed) fireEvent.keyDown(editor, { key });
}

/**
 * One click with the mouse. `detail` is the click count CodeMirror reads, and
 * jsdom's default of zero would select the line.
 */
function click(target: Element): void {
  fireEvent.mouseDown(target, { button: 0, detail: 1 });
  fireEvent.mouseUp(target, { button: 0, detail: 1 });
}

function cursor(view: EditorView, at: number): void {
  act(() => {
    view.dispatch({ selection: EditorSelection.cursor(at) });
  });
}

/** The source of every formula KaTeX drew, which it writes into the MathML it hides. */
function drawn(container: HTMLElement, selector: string): string[] {
  return [...container.querySelectorAll(`${selector} .katex-mathml annotation`)].map(
    (node) => node.textContent ?? "",
  );
}

/** The first line is prose so the cursor, at offset zero, is off the formula. */
const ABOVE = "intro\n\n";

const VIM = [
  ["vim on", true],
  ["vim off", false],
] as const;

// The first formula drawn fetches KaTeX and its stylesheet, and the widget
// fills its box only when that lands. Cold, under a loaded full run, that took
// longer than waitFor's one second, and the first test to draw math failed
// (#630). Loading it once here leaves every test the cached module; the spy is
// cleared before each, so the A8 tests still see only their own loads.
beforeAll(async () => {
  await loadKatex();
});
beforeEach(() => {
  localStorage.clear();
  vi.mocked(loadKatex).mockClear();
});
afterEach(() => localStorage.clear());

describe("inline math", () => {
  for (const [label, vimOn] of VIM) {
    it(`A2 draws inline math, ${label}`, async () => {
      const { container } = editor(`${ABOVE}area $x^2$ here`, vimOn);

      await waitFor(() => expect(drawn(container, ".cm-math")).toEqual(["x^2"]));
      expect(container.querySelector(".cm-math .katex-display")).toBeNull();
      expect(content(container)).not.toContain("$");
    });
  }

  it("A4 shows the source in insert mode with the cursor at it, vim on", async () => {
    const doc = `${ABOVE}area $x^2$ here`;
    const { container } = editor(doc, true);
    const view = viewIn(container);
    await waitFor(() => expect(drawn(container, ".cm-math")).toEqual(["x^2"]));

    cursor(view, doc.indexOf("$x"));
    // Normal mode reads: the cursor beside the formula leaves it drawn.
    expect(container.querySelector(".cm-math")).not.toBeNull();

    keys(container, "i");
    await waitFor(() => expect(content(container)).toContain("$x^2$"));
    expect(container.querySelector(".cm-math")).toBeNull();
  });

  it("A4 shows the source with the cursor in it, vim off", async () => {
    const doc = `${ABOVE}area $x^2$ here`;
    const { container } = editor(doc, false);
    const view = viewIn(container);
    await waitFor(() => expect(drawn(container, ".cm-math")).toEqual(["x^2"]));

    cursor(view, doc.indexOf("x^2"));

    expect(content(container)).toContain("$x^2$");
    expect(container.querySelector(".cm-math")).toBeNull();
  });

  it("I6 steps over the formula in normal mode, never onto a hidden character", async () => {
    const doc = `${ABOVE}a $x$ b`;
    const { container } = editor(doc, true);
    const view = viewIn(container);
    const from = doc.indexOf("$x$");

    cursor(view, from - 1);
    keys(container, "l");

    expect(view.state.selection.main.head).toBe(from + 3);
    keys(container, "x");
    expect(view.state.doc.toString()).toBe(`${ABOVE}a $x$b`);
  });

  for (const [label, vimOn] of VIM) {
    it(`A7 a click on inline math puts the cursor at it, ${label}`, async () => {
      const doc = `${ABOVE}area $x^2$ here`;
      const { container } = editor(doc, vimOn);
      const view = viewIn(container);
      await waitFor(() => expect(drawn(container, ".cm-math")).toEqual(["x^2"]));
      const at = doc.indexOf("$x") + 2;
      // jsdom lays nothing out, so where the click lands is said here.
      Object.defineProperty(view, "posAndSideAtCoords", { value: () => ({ pos: at, assoc: 1 }) });

      const formula = container.querySelector(".cm-math") as HTMLElement;
      click(formula);

      // Walked out of the hidden source to the end of the formula.
      const end = doc.indexOf("$ here") + 1;
      await waitFor(() => expect(view.state.selection.main.head).toBe(end));
      // With vim off the editor is in insert mode, so the source is back.
      if (!vimOn) expect(content(container)).toContain("$x^2$");
      else expect(container.querySelector(".cm-math")).not.toBeNull();
    });
  }
});

describe("block math", () => {
  const ONE = `${ABOVE}$$x^2$$\n\nafter`;
  const MANY = `${ABOVE}$$\n\\frac{a}{b}\n$$\n\nafter`;

  for (const [label, vimOn] of VIM) {
    it(`A3 draws a one-line block as display math, ${label}`, async () => {
      const { container } = editor(ONE, vimOn);

      await waitFor(() => expect(drawn(container, ".cm-math-block")).toEqual(["x^2"]));
      expect(container.querySelector(".cm-math-block .katex-display")).not.toBeNull();
      expect(content(container)).not.toContain("$$");
    });

    it(`A3 draws a block between two fence lines as display math, ${label}`, async () => {
      const { container } = editor(MANY, vimOn);

      await waitFor(() => expect(drawn(container, ".cm-math-block")).toEqual(["\\frac{a}{b}"]));
      expect(container.querySelector(".cm-math-block .katex-display")).not.toBeNull();
      expect(content(container)).not.toContain("$$");
    });

    it(`A4 shows a block's source with the cursor in it in any mode, ${label}`, async () => {
      const { container } = editor(MANY, vimOn);
      const view = viewIn(container);
      await waitFor(() => expect(drawn(container, ".cm-math-block")).toHaveLength(1));

      // Normal mode with vim on: the table's rule, not the mode's.
      cursor(view, MANY.indexOf("frac"));

      expect(container.querySelector(".cm-math-block")).toBeNull();
      expect(content(container)).toContain("$$\\frac{a}{b}$$");
    });

    it(`A7 a click on a block formula shows its source, ${label}`, async () => {
      const { container } = editor(ONE, vimOn);
      const view = viewIn(container);
      await waitFor(() => expect(drawn(container, ".cm-math-block")).toHaveLength(1));
      const at = ONE.indexOf("x^2");
      Object.defineProperty(view, "posAndSideAtCoords", { value: () => ({ pos: at, assoc: 1 }) });

      const formula = container.querySelector(".cm-math-block .katex") as HTMLElement;
      click(formula);

      await waitFor(() => expect(container.querySelector(".cm-math-block")).toBeNull());
      expect(view.state.selection.main.head).toBe(at);
      expect(content(container)).toContain("$$x^2$$");
    });
  }

  it("I2 draws block math in a read-only view at offset zero", async () => {
    const { container } = render(<NotePreview text={"$$x^2$$\n\nafter $y$"} />);

    await waitFor(() => expect(drawn(container, ".cm-math-block")).toEqual(["x^2"]));
    expect(drawn(container, ".cm-math")).toEqual(["y"]);
    expect(content(container)).not.toContain("$");
  });

  it("A9 a read-only view, as an embed or the finder mounts, draws math", async () => {
    const parent = document.body.appendChild(document.createElement("div"));
    const view = new EditorView({
      state: EditorState.create({
        doc: "$$\n\\sum_i i\n$$\n\nand $z$",
        extensions: [
          EditorView.editable.of(false),
          EditorState.readOnly.of(true),
          noteLanguage(),
          renderedMarkdown(),
          kastenTheme,
        ],
      }),
      parent,
    });

    await waitFor(() => expect(drawn(parent, ".cm-math-block")).toEqual(["\\sum_i i"]));
    expect(drawn(parent, ".cm-math")).toEqual(["z"]);
    view.destroy();
    parent.remove();
  });

  it("I3 redraws the edited formula on leaving, and undo brings the old one back", async () => {
    const { container } = editor(ONE, false);
    const view = viewIn(container);
    await waitFor(() => expect(drawn(container, ".cm-math-block")).toEqual(["x^2"]));
    const at = ONE.indexOf("x^2");

    cursor(view, at);
    act(() => {
      view.dispatch({ changes: { from: at, to: at + 1, insert: "y" } });
    });
    cursor(view, 0);
    await waitFor(() => expect(drawn(container, ".cm-math-block")).toEqual(["y^2"]));

    act(() => {
      undo(view);
    });
    cursor(view, 0);
    await waitFor(() => expect(drawn(container, ".cm-math-block")).toEqual(["x^2"]));
  });

  it("I4 an unclosed block stays text and leaves the rest of the note alone", () => {
    const { container } = editor(`${ABOVE}$$\nx^2\n\n# Below\n\n**bold**`, true);

    expect(container.querySelector(".cm-math-block")).toBeNull();
    expect(content(container)).toContain("$$x^2");
    expect(container.querySelector(".cm-heading-1")?.textContent).toBe("Below");
    expect(container.querySelector(".cm-strong")?.textContent).toBe("bold");
  });
});

describe("what stays text", () => {
  it("A6 leaves prices as prose, as Obsidian does", () => {
    const { container } = editor(`${ABOVE}costs $5 and $6 today, or $ 7 $`, true);

    expect(container.querySelector(".cm-math")).toBeNull();
    expect(content(container)).toContain("costs $5 and $6 today, or $ 7 $");
  });

  it("A6 keeps an escaped dollar a dollar and a double dollar mid-line no formula", () => {
    const { container } = editor(`${ABOVE}a \\$x$ b and $$ c`, true);

    expect(container.querySelector(".cm-math")).toBeNull();
    expect(content(container)).toContain("a $x$ b and $$ c");
  });

  it("I4 an unclosed inline dollar stays text", () => {
    const { container } = editor(`${ABOVE}a $x b`, true);

    expect(container.querySelector(".cm-math")).toBeNull();
    expect(content(container)).toContain("a $x b");
  });

  it("I5 keeps math in inline code and in a fence as code", () => {
    const { container } = editor(`${ABOVE}\`$x$\`\n\n\`\`\`\n$y$\n\`\`\`\n\nend`, true);

    expect(container.querySelector(".cm-math, .cm-math-block")).toBeNull();
    expect(container.querySelector(".cm-inline-code")?.textContent).toBe("$x$");
    expect(content(container)).toContain("$y$");
  });
});

describe("a bad formula", () => {
  it("A5 shows an error and its source, inline and as a block", async () => {
    const { container } = editor(`${ABOVE}bad $\\frac{$ here\n\n$$\\left($$\n\nend`, true);

    await waitFor(() => expect(container.querySelectorAll(".katex-error")).toHaveLength(2));
    const [inline, block] = [...container.querySelectorAll<HTMLElement>(".katex-error")];
    expect(inline?.closest(".cm-math")).not.toBeNull();
    expect(inline?.textContent).toBe("\\frac{");
    expect(inline?.title).toContain("ParseError");
    expect(inline?.style.color).toBe("var(--k-danger)");
    expect(block?.closest(".cm-math-block")).not.toBeNull();
    expect(block?.textContent).toBe("\\left(");
    expect(block?.title).toContain("ParseError");
  });
});

describe("loading KaTeX", () => {
  it("A8 a note without math never loads KaTeX", () => {
    const { container } = editor(`${ABOVE}costs $5 and **bold**\n\n| a |\n| - |\n| 1 |`, true);
    render(<NotePreview text="plain $5 text" />);

    expect(content(container)).toContain("costs $5");
    expect(loadKatex).not.toHaveBeenCalled();
  });

  it("A8 a note with math loads KaTeX", async () => {
    const { container } = editor(`${ABOVE}area $x$`, true);

    expect(loadKatex).toHaveBeenCalled();
    await waitFor(() => expect(drawn(container, ".cm-math")).toEqual(["x"]));
  });
});

describe("colour", () => {
  it("A10 KaTeX sets no colour of its own, so math wears the editor's text colour", async () => {
    const css = readFileSync("node_modules/katex/dist/katex.min.css", "utf8");
    const colours = [...css.matchAll(/(?:^|[;{\s])color:([^;}]+)/g)].map((found) => found[1]);
    expect(colours.every((value) => value === "currentColor" || value === "inherit")).toBe(true);

    const { container } = editor(`${ABOVE}area $x$`, true);
    await waitFor(() => expect(drawn(container, ".cm-math")).toEqual(["x"]));
    const formula = container.querySelector(".cm-math") as HTMLElement;
    for (const node of [formula, ...formula.querySelectorAll("*")]) {
      expect(node.getAttribute("style") ?? "").not.toContain("color");
    }
  });
});
