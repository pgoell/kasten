import { history, redo, undo } from "@codemirror/commands";
import {
  ensureSyntaxTree,
  forceParsing,
  syntaxTree,
  syntaxTreeAvailable,
} from "@codemirror/language";
import { EditorState, Text, type TransactionSpec } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import { Tree } from "@lezer/common";
import { noteLanguage } from "@/lib/markdown/note-language";
import { setVimMode, vimKeys } from "@/lib/notes/editor/vim-mode";
import { vaultPaths, wikiLinkAt } from "@/lib/notes/links/wikilink";
import { livePreview, renderedMarkdown } from "@/lib/notes/live/live-preview";
import { stalled } from "./live-preview-fixture";

/** Whether some decoration replaces the range with a widget. */
function drawn(view: EditorView, from: number, to: number): boolean {
  let found = false;
  for (const source of view.state.facet(EditorView.decorations)) {
    const set = typeof source === "function" ? source(view) : source;
    set.between(from, to, (start, end, value) => {
      if (start === from && end === to && value.spec.widget) found = true;
    });
  }
  return found;
}

/** The tree `doc` parses to, as lezer prints it. */
function tree(doc: string): string {
  // A fresh state parses for only 20 ms, which a cold worker under the full
  // suite can spend before the parser reaches the end of even a short doc
  // (#533). A view parses the rest later; a bare state never does.
  const state = EditorState.create({ doc, extensions: [noteLanguage()] });
  const parsed = ensureSyntaxTree(state, doc.length, 10_000);
  if (!parsed) throw new Error(`the parser did not reach the end of ${JSON.stringify(doc)}`);
  return parsed.toString();
}

describe("an embed", () => {
  it("parses ![[note]] as an embed around the wikilink it holds", () => {
    expect(tree("![[note#Heading|alias]]")).toContain(
      "Embed(EmbedMark,WikiLink(WikiLinkMark,WikiLinkMark))",
    );
    expect(tree("![[note]]")).not.toContain("Image");
  });

  it("leaves the link under the embed readable to gf", () => {
    // wikiLinkAt reads the state's own tree, which ensureSyntaxTree leaves as
    // it was; forceParsing lands the whole tree in the view's state.
    const view = new EditorView({
      state: EditorState.create({ doc: "![[note]]", extensions: [noteLanguage()] }),
    });
    if (!forceParsing(view, view.state.doc.length, 10_000))
      throw new Error("the parser fell short");

    expect(wikiLinkAt(view.state, 4)).toBe("note");
    view.destroy();
  });

  it("refuses what a wikilink refuses", () => {
    expect(tree("![[note")).not.toContain("Embed");
    expect(tree("![[  ]]")).not.toContain("Embed");
    expect(tree("![[a\nb]]")).not.toContain("Embed");
  });

  it("leaves a markdown image an image", () => {
    expect(tree("![alt](shot.png)")).toContain("Image");
    expect(tree("![alt](shot.png)")).not.toContain("Embed");
  });
});

describe("a note longer than the first parse", () => {
  it("draws what the parser reaches after the note has opened", () => {
    // The first parse stops a few thousand characters in and the rest lands
    // later in slices, each a transaction that changes nothing else. A long
    // clipped article's later pictures sat as text until the cursor moved.
    const image = "![](https://example.com/late.png)";
    const doc = `${"A paragraph that the parser has to walk through.\n\n".repeat(2000)}${image}`;
    const view = new EditorView({
      state: EditorState.create({ doc, extensions: [noteLanguage(), renderedMarkdown()] }),
    });
    const from = doc.length - image.length;

    expect(syntaxTree(view.state).length).toBeLessThan(from);
    // The worker parses 3 s per 30 s in idle slices, so a busy box outlasts
    // any wait; this lands the tree as the empty transaction a slice sends.
    forceParsing(view, doc.length, 10_000);
    expect(drawn(view, from, doc.length)).toBe(true);
    view.destroy();
  });
});

describe("a drawing kept past a parse that ran out", () => {
  /** The ranges drawn with `name`, by their offsets. */
  function marked(view: EditorView, name: string): string[] {
    const found: string[] = [];
    for (const source of view.state.facet(EditorView.decorations)) {
      const set = typeof source === "function" ? source(view) : source;
      set.between(0, view.state.doc.length, (from, to, value) => {
        if (String(value.spec.class ?? "").includes(name)) found.push(`${from}-${to}`);
      });
    }
    return found;
  }

  /** On a clock that jumps `by` at every read, so each parse step runs out of its 20ms. */
  function starved(doc: string, by: number): EditorView {
    let now = Date.now();
    const clock = vi.spyOn(Date, "now").mockImplementation(() => (now += by));
    try {
      const extensions = [
        noteLanguage(),
        vimKeys.of(false),
        livePreview(),
        vaultPaths.of(["b.md"]),
      ];
      return new EditorView({
        state: EditorState.create({ doc, extensions }),
        parent: document.body,
      });
    } finally {
      clock.mockRestore();
    }
  }

  it("draws a link past the first parse's reach once, however often the cursor moves (#2227)", () => {
    const doc = "intro\n\nsee [[b|Bee]] now\n";
    // 12ms a read lets the first parse take two steps: the tree holds the link, its reach does not.
    const view = starved(doc, 12);
    const at = doc.indexOf("Bee");
    expect([marked(view, "cm-wikilink"), syntaxTreeAvailable(view.state, at)]).toEqual([
      [`${at}-${at + 3}`],
      false,
    ]);
    // Every range, the hidden `[[b|` and `]]` among them, which the cursor's nudge reads.
    const ranges = marked(view, "");
    for (const anchor of [1, 0, 2, 1]) stalled(() => view.dispatch({ selection: { anchor } }));

    expect(syntaxTreeAvailable(view.state, at)).toBe(false);
    expect(marked(view, "cm-wikilink")).toEqual([`${at}-${at + 3}`]);
    expect(marked(view, "")).toEqual(ranges);
    expect(view.dom.querySelectorAll(".cm-wikilink")).toHaveLength(1);
    view.destroy();
  });
});

interface Drawn {
  key: string;
  widget?: WidgetType;
}

/** Every decoration the state's fields draw, by place and kind. */
function drawing(view: EditorView): Drawn[] {
  const out: Drawn[] = [];
  for (const source of view.state.facet(EditorView.decorations)) {
    if (typeof source === "function") continue;
    source.between(0, view.state.doc.length, (from, to, value) => {
      const { widget, ...spec } = value.spec as { widget?: WidgetType };
      out.push({
        key: `${from}-${to} ${JSON.stringify(spec)} ${widget?.constructor.name ?? ""}`,
        widget,
      });
    });
  }
  // Two fields draw, and which of them holds a range does not matter on the screen.
  return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * `a`'s keys, each marked where its widget differs from `b`'s: by the widget's own `eq`, which is what CodeMirror
 * reads to keep or redraw it, or by its plain fields where it has none.
 */
function against(a: Drawn[], b: Drawn[]): string[] {
  const plain = (w: WidgetType) =>
    JSON.stringify(
      Object.entries(w).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v)),
    );
  return a.map(({ key, widget }, i) => {
    const other = b[i]?.widget;
    if (!widget || !other) return widget || other ? `${key} (one widget)` : key;
    if (widget.constructor !== other.constructor) return `${key} (widget differs)`;
    const same =
      widget.eq !== WidgetType.prototype.eq ? widget.eq(other) : plain(widget) === plain(other);
    return same ? key : `${key} (widget differs)`;
  });
}

/** Expects `view` to draw what `base` drew. */
function expectDrawn(view: EditorView, base: Drawn[], name: string): void {
  expect(against(drawing(view), base), name).toEqual(base.map((d) => d.key));
}

const NOTE_2331 = [
  "# Title",
  "",
  "Intro with [[Small]], a [ref link][r] and #tag.",
  "",
  "## Lists",
  "- one **bold**",
  "- [ ] parent",
  "  - [ ] child",
  "  - [x] done",
  "1. first",
  "",
  "| a | b |",
  "| - | - |",
  "| 1 | [[x]] |",
  "",
  "```",
  "const a = 1;",
  "```",
  "",
  "![[Small]]",
  "",
  "> [!note] Title",
  "> body text",
  "",
  "Para line",
  "---",
  "",
  "$x^2$ math and `code`",
  "",
  "[r]: https://example.com",
  "",
  "At [00:05] it starts.",
  "",
  "Last [[Other|alias]] line.",
].join("\n");

describe("#2331 an edit redraws only the blocks it touched", () => {
  const extensions = (vim: boolean) => [
    noteLanguage(),
    livePreview(),
    history(),
    vimKeys.of(vim),
    vaultPaths.of(["Small.md", "x.md"]),
  ];
  const mount = (doc: string, vim: boolean) => {
    const view = new EditorView({
      state: EditorState.create({ doc, extensions: extensions(vim) }),
    });
    if (vim) view.dispatch({ effects: setVimMode.of("insert") });
    forceParsing(view, view.state.doc.length, 10_000);
    view.dispatch({});
    return view;
  };
  /** What a whole walk over the same text, cursor and mode draws. */
  const fresh = (view: EditorView, vim: boolean): Drawn[] => {
    const other = new EditorView({
      state: EditorState.create({
        doc: view.state.doc,
        selection: view.state.selection,
        extensions: extensions(vim),
      }),
    });
    if (vim) other.dispatch({ effects: setVimMode.of("insert") });
    forceParsing(other, other.state.doc.length, 10_000);
    other.dispatch({});
    const out = drawing(other);
    other.destroy();
    return out;
  };
  const at = (view: EditorView, text: string) => {
    const found = view.state.doc.toString().indexOf(text);
    if (found < 0) throw new Error(`no ${text}`);
    return found;
  };
  const type = (pos: number, text: string): TransactionSpec => ({
    changes: { from: pos, insert: text },
    selection: { anchor: pos + text.length },
    userEvent: "input.type",
  });
  type Edit = [name: string, spec: (view: EditorView) => TransactionSpec, patched: boolean];
  const edits: Edit[] = [
    ["a key typed into a heading", (v) => type(at(v, "Title") + 5, "x"), true],
    ["a key typed into a list item", (v) => type(at(v, "one **") + 3, "x"), true],
    ["a key typed into a table cell", (v) => type(at(v, "| 1 |") + 2, "x"), true],
    ["a key typed into a code block", (v) => type(at(v, "const a") + 5, "x"), true],
    ["a key typed into an embed's name", (v) => type(at(v, "![[Small]]") + 7, "x"), true],
    ["a key typed into a wikilink", (v) => type(at(v, "[[Other") + 4, "x"), true],
    ["a key typed into a callout", (v) => type(at(v, "body text") + 4, "x"), true],
    [
      "the cursor moves onto a heading",
      (v) => ({ selection: { anchor: at(v, "## Lists") + 4 } }),
      true,
    ],
    ["the cursor moves off it", (v) => ({ selection: { anchor: at(v, "Para line") } }), true],
    [
      "a child todo ticked",
      (v) => ({
        changes: { from: at(v, "[ ] child") + 1, to: at(v, "[ ] child") + 2, insert: "x" },
      }),
      true,
    ],
    // Falls back: the open fence runs over the link definition below it.
    ["a fence opened in a paragraph", (v) => type(at(v, "Para line"), "```\n"), false],
    [
      "a closed fence typed over a paragraph",
      (v) => type(at(v, "Para line"), "```\nx\n```\n"),
      true,
    ],
    [
      "a setext underline deleted",
      (v) => ({ changes: { from: at(v, "\n---\n"), to: at(v, "\n---\n") + 4 } }),
      true,
    ],
    [
      "a delete across a heading and a list",
      (v) => ({
        changes: { from: at(v, "## Lists"), to: at(v, "bold**") + 2 },
        userEvent: "delete",
      }),
      true,
    ],
    [
      "a block pasted over a table and a paragraph",
      (v) => ({
        changes: {
          from: at(v, "| a |"),
          to: at(v, "= 1;"),
          insert: "## New\n- a\n- b\n\n> quote\n\n```\n",
        },
        userEvent: "input.paste",
      }),
      true,
    ],
    [
      "two edits far apart in one transaction",
      (v) => ({
        changes: [
          { from: at(v, "Title"), insert: "a" },
          { from: at(v, "Last"), insert: "b" },
        ],
      }),
      true,
    ],
    [
      "a frontmatter stamp at the top, the cursor lower",
      () => ({ changes: { from: 0, insert: "---\nid: x\n---\n" } }),
      false,
    ],
    [
      "a video link typed, which a time elsewhere seeks",
      (v) => type(at(v, "Last"), "[00:10](https://www.youtube.com/watch?v=abcdefghijk&t=10s) "),
      false,
    ],
    ["a link definition changed", (v) => type(at(v, "example.com"), "x"), false],
    [
      "a whole-text replace",
      (v) => ({
        changes: { from: 0, to: v.state.doc.length, insert: NOTE_2331.replace("Title", "Other") },
      }),
      false,
    ],
  ];

  for (const vim of [false, true]) {
    it(`draws as a whole walk after each edit, its undo and its redo, vim ${vim ? "insert" : "off"}`, () => {
      const view = mount(NOTE_2331, vim);
      view.dispatch({ selection: { anchor: at(view, "Last") } });
      const whole = vi.spyOn(Tree.prototype, "iterate");
      for (const [name, spec, patched] of edits) {
        whole.mockClear();
        view.dispatch(spec(view));
        // The note's own tree walked whole; the todo counts parse a tree of their own.
        const tree = syntaxTree(view.state);
        const walks = whole.mock.contexts.filter(
          (t, i) => t === tree && whole.mock.calls[i]?.[0].from === undefined,
        ).length;
        if (patched) expect.soft(walks, `${name}: whole walks`).toBe(0);
        expectDrawn(view, fresh(view, vim), name);
        undo(view);
        expectDrawn(view, fresh(view, vim), `${name}, undone`);
        redo(view);
        expectDrawn(view, fresh(view, vim), `${name}, redone`);
        undo(view);
      }
      whole.mockRestore();
      view.destroy();
    });
  }

  it("a key in a long note reads only the lines around it", () => {
    const block = NOTE_2331.replace("[r]: https://example.com", "Plain line.");
    const view = mount(Array(300).fill(block).join("\n\n"), false);
    view.dispatch({ selection: { anchor: 3 } });
    const lines = vi.spyOn(Text.prototype, "lineAt");
    view.dispatch(type(3, "x"));
    expect(lines.mock.calls.length).toBeLessThan(100);
    lines.mockRestore();
    view.destroy();
  });

  it("a renderedMarkdown view patches too", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: NOTE_2331,
        extensions: [noteLanguage(), renderedMarkdown()],
      }),
    });
    forceParsing(view, view.state.doc.length, 10_000);
    view.dispatch({});
    view.dispatch({ changes: { from: at(view, "Title") + 5, insert: "x" } });
    const other = new EditorView({
      state: EditorState.create({
        doc: view.state.doc,
        extensions: [noteLanguage(), renderedMarkdown()],
      }),
    });
    forceParsing(other, other.state.doc.length, 10_000);
    other.dispatch({});
    expectDrawn(view, drawing(other), "renderedMarkdown");
    other.destroy();
    view.destroy();
  });
});
