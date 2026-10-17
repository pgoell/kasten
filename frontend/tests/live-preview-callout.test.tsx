/// <reference types="node" />

import { readFileSync } from "node:fs";
import { undoDepth } from "@codemirror/commands";
import { forceParsing } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { act, fireEvent, type RenderResult, render, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { Editor } from "@/components/editor";
import { NotePreview } from "@/components/note-preview";
import { COARSE, NARROW, stubMatchMedia } from "./match-media";

function content(container: HTMLElement): string {
  return (container.querySelector(".cm-content") as HTMLElement).textContent ?? "";
}

/** Parses the whole note before a test reads the first draw (#365). */
function parsed(view: EditorView): void {
  act(() => {
    forceParsing(view, view.state.doc.length, 5000);
  });
}

/** `render` for an `Editor`, its note parsed to the end. */
function renderEditor(ui: ReactElement): RenderResult {
  const result = render(ui);
  const dom = result.container.querySelector(".cm-editor") as HTMLElement;
  parsed(EditorView.findFromDOM(dom) as EditorView);
  return result;
}

function viewIn(container: HTMLElement): EditorView {
  return EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement) as EditorView;
}

function keys(container: HTMLElement, ...pressed: string[]): void {
  const editor = container.querySelector(".cm-content") as HTMLElement;
  for (const key of pressed) fireEvent.keyDown(editor, { key });
}

/** An `Editor` with vim on or off for certain, not left to the pointer. */
function editor(doc: string, vimOn: boolean): RenderResult {
  localStorage.setItem("kasten.vim", vimOn ? "on" : "off");
  return renderEditor(<Editor initialDoc={doc} />);
}

/** The classes of every line drawn as part of a callout. */
function boxLines(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(".cm-line.cm-callout")];
}

/** A tap as a phone delivers it: a touch press, then the mouse events it ends in. */
function tap(target: Element): void {
  fireEvent.pointerDown(target, { pointerType: "touch" });
  fireEvent.mouseDown(target);
  fireEvent.mouseUp(target);
  fireEvent.click(target);
}

/** The first line is prose so the cursor, at offset zero, is off the callout. */
const ABOVE = "intro\n\n";

const FOLDED = `${ABOVE}> [!faq]- Why\n> because\n> of this\n\nafter`;

const VIM = [
  ["vim on", true],
  ["vim off", false],
] as const;

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

/** Every name Obsidian knows and the kind it draws as, spelled here, not imported. */
const NAMES: [string, string][] = [
  ["note", "note"],
  ["abstract", "abstract"],
  ["summary", "abstract"],
  ["tldr", "abstract"],
  ["info", "info"],
  ["todo", "todo"],
  ["tip", "tip"],
  ["hint", "tip"],
  ["important", "tip"],
  ["success", "success"],
  ["check", "success"],
  ["done", "success"],
  ["question", "question"],
  ["help", "question"],
  ["faq", "question"],
  ["warning", "warning"],
  ["caution", "warning"],
  ["attention", "warning"],
  ["failure", "failure"],
  ["fail", "failure"],
  ["missing", "failure"],
  ["danger", "danger"],
  ["error", "danger"],
  ["bug", "bug"],
  ["example", "example"],
  ["quote", "quote"],
  ["cite", "quote"],
  ["mytype", "note"],
];

describe("a callout", () => {
  // One test per name rather than a loop of 28 editors in one, which on a
  // loaded machine ran past the five seconds a test gets.
  it.each(
    NAMES.flatMap(([name, kind]) =>
      VIM.map(([label, vimOn]) => [name, kind, label, vimOn] as const),
    ),
  )("draws [!%s] as the %s box with its icon: %s", (name, kind, _, vimOn) => {
    // Upper case for the aliases: Obsidian reads the type without regard to it.
    const written = kind === name ? name : name.toUpperCase();
    const { container } = editor(`${ABOVE}> [!${written}]\n> body`, vimOn);

    const lines = boxLines(container);
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line).toHaveClass(`cm-callout-${kind}`);
    expect(lines[0]?.querySelector(".cm-callout-icon")).not.toBeNull();
    expect(content(container)).not.toContain("[!");
    expect(content(container)).not.toContain(">");
  });

  it.each(VIM)("shows a written title as the title: %s", (_, vimOn) => {
    const { container } = editor(`${ABOVE}> [!faq] Why **this**\n> body`, vimOn);

    const head = boxLines(container)[0] as HTMLElement;
    expect(head.textContent).toBe("Why this");
    expect(head.querySelector(".cm-callout-header .cm-callout-title")).toBeNull();
    expect(head.querySelector(".cm-callout-title")?.textContent).toBe("Why this");
  });

  it.each(VIM)("titles a callout with none written by its type: %s", (_, vimOn) => {
    for (const sign of ["", "-", "+"]) {
      const { container, unmount } = editor(`${ABOVE}> [!faq]${sign}\n> body`, vimOn);

      const title = container.querySelector(".cm-callout-header .cm-callout-title");
      expect(title?.textContent, sign).toBe("Faq");
      unmount();
    }
  });

  it.each(VIM)("starts a - callout shut and a + callout open: %s", (_, vimOn) => {
    const { container } = editor(
      `${ABOVE}> [!faq]- Shut\n> hidden body\n\n> [!faq]+ Open\n> shown body`,
      vimOn,
    );

    expect(content(container)).not.toContain("hidden body");
    expect(content(container)).toContain("shown body");
    const toggles = container.querySelectorAll(".cm-callout-fold");
    expect(toggles).toHaveLength(2);
    expect(toggles[0]).not.toHaveClass("cm-callout-fold-open");
    expect(toggles[1]).toHaveClass("cm-callout-fold-open");
  });

  it.each(VIM)("does not fold a callout with no sign: %s", (_, vimOn) => {
    const { container } = editor(`${ABOVE}> [!faq] Plain\n> body`, vimOn);

    expect(container.querySelector(".cm-callout-header")).not.toBeNull();
    expect(container.querySelector(".cm-callout-fold")).toBeNull();
    expect(content(container)).toContain("body");
  });

  it.each(VIM)("opens and shuts by a click on the toggle: %s", async (_, vimOn) => {
    const { container } = editor(FOLDED, vimOn);
    const head = viewIn(container).state.selection.main.head;

    fireEvent.mouseDown(container.querySelector(".cm-callout-fold") as HTMLElement);
    fireEvent.click(container.querySelector(".cm-callout-fold") as HTMLElement);
    await waitFor(() => expect(content(container)).toContain("because"));

    fireEvent.click(container.querySelector(".cm-callout-fold") as HTMLElement);
    await waitFor(() => expect(content(container)).not.toContain("because"));
    expect(viewIn(container).state.selection.main.head).toBe(head);
  });

  it.each(VIM)("opens by a click on a default title: %s", async (_, vimOn) => {
    const { container } = editor(`${ABOVE}> [!faq]-\n> because`, vimOn);

    fireEvent.click(container.querySelector(".cm-callout-header") as HTMLElement);

    await waitFor(() => expect(content(container)).toContain("because"));
    expect(content(container)).not.toContain("[!");
  });

  it.each(VIM)("draws a callout in a callout as a box in a box: %s", (_, vimOn) => {
    const { container } = editor(
      `${ABOVE}> [!note] Outer\n> > [!tip] Inner\n> > inner body\n>\n> outer body`,
      vimOn,
    );

    const lines = boxLines(container);
    expect(lines.map((line) => line.textContent)).toEqual([
      "Outer",
      "Inner",
      "inner body",
      "",
      "outer body",
    ]);
    expect(lines[0]).toHaveClass("cm-callout-note");
    expect(lines[0]).not.toHaveClass("cm-callout-nested");
    for (const line of lines.slice(1, 3)) {
      expect(line).toHaveClass("cm-callout-tip");
      expect(line).toHaveClass("cm-callout-nested");
    }
    expect(lines[4]).toHaveClass("cm-callout-note");
    expect(content(container)).not.toContain("[!");
  });

  it.each(VIM)("draws a callout in a list item as a box: %s", (_, vimOn) => {
    const { container } = editor(`${ABOVE}- > [!tip] Listed\n  > body`, vimOn);

    const lines = boxLines(container);
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line).toHaveClass("cm-callout-tip");
    expect(content(container)).not.toContain("[!");
  });

  it.each(VIM)("draws a callout in a plain quote as a box: %s", (_, vimOn) => {
    const { container } = editor(`${ABOVE}> plain\n> > [!tip] Quoted\n> > body`, vimOn);

    const quote = container.querySelector(".cm-line.cm-blockquote");
    expect(quote?.textContent).toBe("plain");
    expect(quote).not.toHaveClass("cm-callout");
    const lines = boxLines(container);
    expect(lines.map((line) => line.textContent)).toEqual(["Quoted", "body"]);
    for (const line of lines) expect(line).not.toHaveClass("cm-blockquote");
    expect(content(container)).not.toContain("[!");
  });

  it("shows the whole source with the cursor in it, vim off", async () => {
    const { container } = editor(`${ABOVE}> [!note] Title\n> body\n> more`, false);
    const view = viewIn(container);

    act(() => view.dispatch({ selection: { anchor: view.state.doc.length } }));

    await waitFor(() => expect(content(container)).toBe(`intro> [!note] Title> body> more`));
  });

  it.each(["i", "v"])("shows the whole source with the cursor in it in vim %s", async (key) => {
    const { container } = editor(`${ABOVE}> [!note] Title\n> body\n> more`, true);
    const view = viewIn(container);
    act(() => view.dispatch({ selection: { anchor: view.state.doc.length - 2 } }));

    keys(container, key);

    await waitFor(() => expect(content(container)).toBe(`intro> [!note] Title> body> more`));
  });

  it("renders with the cursor in it in vim normal mode", () => {
    const { container } = editor(`${ABOVE}> [!note] Title\n> body\n> more`, true);
    const view = viewIn(container);

    act(() => view.dispatch({ selection: { anchor: view.state.doc.length - 2 } }));

    expect(content(container)).toBe("introTitlebodymore");
  });

  it("opens rendered by a tap on a phone", () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const { container } = renderEditor(<Editor initialDoc={FOLDED} />);
    const view = viewIn(container);
    const head = view.state.selection.main.head;
    expect(boxLines(container)).toHaveLength(1);

    act(() => tap(container.querySelector(".cm-callout-fold") as HTMLElement));

    expect(content(container)).toContain("because");
    expect(content(container)).not.toContain("[!");
    expect(view.state.selection.main.head).toBe(head);
    expect(boxLines(container)).toHaveLength(3);
  });

  it("keeps its box to the width of the column", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    const rule = /\.cm-line\.cm-callout\s*{([^}]*)}/s.exec(css)?.[1] ?? "";

    expect(rule).toContain("border-left");
    expect(rule).not.toMatch(/\b(width|white-space|min-width)\s*:/);
  });

  it("gives every kind a colour from the palette", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    const kinds = new Set(NAMES.map(([, kind]) => kind));

    expect(kinds.size).toBe(13);
    for (const kind of kinds) {
      expect(css).toMatch(new RegExp(`--callout-${kind}:\\s*var\\(--color-one-[a-z]+\\)`));
      expect(css).toMatch(
        new RegExp(`\\.cm-callout-${kind}\\s*{[^}]*--callout-color:\\s*var\\(--callout-${kind}\\)`),
      );
    }
  });

  it.each(VIM)("folds as view state: no edit, nothing to undo: %s", async (_, vimOn) => {
    const { container } = editor(FOLDED, vimOn);
    const view = viewIn(container);

    fireEvent.click(container.querySelector(".cm-callout-fold") as HTMLElement);
    await waitFor(() => expect(content(container)).toContain("because"));

    expect(view.state.doc.toString()).toBe(FOLDED);
    expect(undoDepth(view.state)).toBe(0);
  });

  it.each(VIM)("stays open while typing elsewhere: %s", async (_, vimOn) => {
    const { container } = editor(FOLDED, vimOn);
    const view = viewIn(container);
    fireEvent.click(container.querySelector(".cm-callout-fold") as HTMLElement);
    await waitFor(() => expect(content(container)).toContain("because"));

    act(() => view.dispatch({ changes: { from: 0, insert: "more " } }));
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: " too" } }));

    expect(content(container)).toContain("because");
    expect(content(container)).toContain("after too");
  });

  // `j`, `k` and the arrows move by what is on the screen, and jsdom draws
  // nothing, so they are not asked here: they step over the body because it is
  // a replaced range. What jsdom can check is a motion by document position.
  it("keeps a line jump out of a folded body in vim", () => {
    const { container } = editor(FOLDED, true);
    const view = viewIn(container);

    keys(container, "4", "G");

    // Line 4 is the body's first; the jump lands on the blank line under it.
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(6);
    expect(content(container)).not.toContain("because");
  });

  it("keeps a jump out of a folded body in vim normal mode", () => {
    const { container } = editor(FOLDED, true);
    const view = viewIn(container);
    const body = view.state.doc.line(4);

    act(() => view.dispatch({ selection: { anchor: body.from + 2 } }));

    const head = view.state.selection.main.head;
    expect(head < body.from || head > view.state.doc.line(5).to).toBe(true);
    expect(content(container)).not.toContain("because");
  });

  it.each(VIM)("shows the body of a folded callout the cursor enters: %s", async (_, vimOn) => {
    const { container } = editor(FOLDED, vimOn);
    const view = viewIn(container);

    act(() => view.dispatch({ selection: { anchor: view.state.doc.line(3).to } }));
    if (vimOn) keys(container, "i");

    await waitFor(() => expect(content(container)).toContain("> [!faq]- Why> because> of this"));
  });

  it.each(VIM)("is not one on a later line, outside a quote or in a fence: %s", (_, vimOn) => {
    for (const doc of [
      `${ABOVE}> plain\n> [!note] not\n> body`,
      `${ABOVE}[!note] not`,
      `${ABOVE}\`\`\`\n> [!note] not\n\`\`\``,
    ]) {
      // A callout under each, so the case is told apart from drawing none at all.
      const { container, unmount } = editor(`${doc}\n\n> [!tip] Real\n> x`, vimOn);

      expect(container.querySelector(".cm-callout-note"), doc).toBeNull();
      expect(container.querySelectorAll(".cm-callout-header"), doc).toHaveLength(1);
      expect(boxLines(container).map((line) => line.textContent)).toEqual(["Real", "x"]);
      unmount();
    }
  });

  it.each(VIM)("draws a callout with no body as its title alone: %s", (_, vimOn) => {
    const { container } = editor(`${ABOVE}> [!note] Alone\n\nafter`, vimOn);

    const lines = boxLines(container);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveClass("cm-callout-open");
    expect(lines[0]).toHaveClass("cm-callout-close");
    expect(lines[0]?.textContent).toBe("Alone");
  });

  it("draws in a preview pane, and folds there", async () => {
    const { container } = render(<NotePreview text={"> [!warning]- Mind\n> the gap"} />);

    expect(boxLines(container)[0]).toHaveClass("cm-callout-warning");
    expect(content(container)).toBe("Mind");

    fireEvent.click(container.querySelector(".cm-callout-fold") as HTMLElement);

    await waitFor(() => expect(content(container)).toBe("Mindthe gap"));
  });
});

/** A folded callout with nothing after it, so no line waits under the body. */
const LAST = `${ABOVE}> [!faq]- Why\n> because`;

describe("a folded callout's hidden body", () => {
  it("is not what dd deletes after G at the end of the note", async () => {
    const { container } = editor(LAST, true);
    const view = viewIn(container);

    keys(container, "G", "d", "d");

    await waitFor(() => expect(view.state.doc.toString()).not.toBe(LAST));
    expect(view.state.doc.toString()).not.toBe(`${ABOVE}> [!faq]- Why`);
    expect(view.state.doc.toString()).toBe(`${ABOVE}> because`);
  });

  it.each(VIM)("keeps the cursor out when the callout ends the note: %s", (_, vimOn) => {
    const { container } = editor(LAST, vimOn);
    const view = viewIn(container);

    act(() => view.dispatch({ selection: { anchor: view.state.doc.length } }));

    expect(view.state.selection.main.head).toBe(view.state.doc.line(3).to);
  });

  it.each(VIM)("lands an upward move from under it on the title: %s", (_, vimOn) => {
    const { container } = editor(`${FOLDED} and a long line under the fold`, vimOn);
    const view = viewIn(container);
    act(() => view.dispatch({ selection: { anchor: view.state.doc.length } }));

    // Where a move up from far along the line lands: the end of the body,
    // which is drawn at the end of the title.
    act(() => view.dispatch({ selection: { anchor: view.state.doc.line(5).to } }));

    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(3);
  });
});

describe("a click on a written title", () => {
  it.each(VIM)("opens the fold without moving the cursor: %s", async (_, vimOn) => {
    const { container } = editor(FOLDED, vimOn);
    const view = viewIn(container);
    const head = view.state.selection.main.head;
    const title = container.querySelector(".cm-callout-title") as HTMLElement;
    expect(title.textContent).toBe("Why");

    fireEvent.mouseDown(title);
    fireEvent.mouseUp(title);
    fireEvent.click(title);

    await waitFor(() => expect(content(container)).toContain("because"));
    expect(content(container)).not.toContain("[!");
    expect(view.state.selection.main.head).toBe(head);
  });
});

describe("a click on a link in a written title", () => {
  it.each(VIM)("leaves the fold alone: %s", async (_, vimOn) => {
    const { container } = editor(`${ABOVE}> [!faq]- See [[Other]] text\n> body`, vimOn);
    const link = container.querySelector(".cm-callout-title .cm-wikilink") as HTMLElement;
    expect(link.textContent).toBe("Other");

    fireEvent.mouseDown(link);
    fireEvent.mouseUp(link);
    fireEvent.click(link);
    // A flip would land by now: the toggle's own click redraws at once.
    await act(async () => {});

    expect(container.querySelector(".cm-callout-fold-open")).toBeNull();
  });
});

describe("the search pane", () => {
  it("opens a folded callout holding the hit", () => {
    const { container } = render(
      <NotePreview
        text={"intro\n\n> [!faq]- Why\n> because\n> of this\n\nafter"}
        firstLine={1}
        markLine={4}
      />,
    );

    expect(container.querySelector(".cm-searchHit")?.textContent).toBe("because");
    expect(content(container)).not.toContain("[!");
  });
});
