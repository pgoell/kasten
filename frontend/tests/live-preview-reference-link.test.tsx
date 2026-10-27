import { forceParsing, LanguageDescription, syntaxTree } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { imagePaths } from "@/lib/image";
import { livePreview } from "@/lib/live/live-preview";
import { noteLanguage } from "@/lib/note-language";
import { vaultPaths } from "@/lib/wikilink";
import { liveHooks, mount, mounted, plain } from "./live-preview-fixture";

liveHooks();

describe("a reference link with a definition (#439)", () => {
  const VIM = [
    ["vim on", true],
    ["vim off", false],
  ] as const;
  const DEFINED = "[docs]: https://example.com";

  function preview(vimOn: boolean): Extension[] {
    return vimOn ? [vim(), livePreview(), vaultPaths.of([]), imagePaths.of([])] : plain(null);
  }

  function lineOf(view: EditorView, n: number): Element {
    return view.contentDOM.querySelectorAll(".cm-line")[n] as Element;
  }

  /** What `element` shows, and the text of the link in it, read in one. */
  function drawn(element: Element): [string | null, string | null | undefined] {
    return [element.textContent, element.querySelector(".cm-link")?.textContent];
  }

  it.each(VIM)("A1 draws [docs] with a definition below as a link reading docs: %s", (_, vimOn) => {
    const line = lineOf(mount(`intro\n\nsee [docs] here\n\n${DEFINED}`, preview(vimOn)), 2);

    expect(drawn(line)).toEqual(["see docs here", "docs"]);
  });

  it("A2 matches the label regardless of case", () => {
    const line = lineOf(mount(`intro\n\nsee [Docs] here\n\n${DEFINED}`, plain(null)), 2);

    expect(drawn(line)).toEqual(["see Docs here", "Docs"]);
  });

  it("A3 takes a definition above the link", () => {
    const line = lineOf(mount(`intro\n\n${DEFINED}\n\nsee [docs] here`, plain(null)), 4);

    expect(drawn(line)).toEqual(["see docs here", "docs"]);
  });

  /**
   * A view of `intro`, `line` and a hundred thousand characters of filler
   * before `tail`, its tree parsed past `line` and no further than the filler.
   */
  function parsedShort(line: string, tail: string): EditorView {
    const filler = "A paragraph that the parser has to walk through.\n\n".repeat(2000);
    const doc = `intro\n\n${line}\n\n${filler}${tail}`;
    // Not `mount`, which parses to the end. The first parse stops when its
    // time runs out, which on a busy machine can be before `line`, so it is
    // carried that far and no further.
    const view = new EditorView({
      state: EditorState.create({ doc, extensions: [noteLanguage(), plain(null)] }),
      parent: document.body.appendChild(document.createElement("div")),
    });
    mounted.push(view);
    act(() => {
      forceParsing(view, `intro\n\n${line}\n\n`.length, 5000);
    });
    return view;
  }

  it("A3 takes a definition past what the parser has reached", () => {
    const view = parsedShort("see [docs] here", DEFINED);

    expect(syntaxTree(view.state).length).toBeLessThan(view.state.doc.length - DEFINED.length);
    expect(drawn(lineOf(view, 2))).toEqual(["see docs here", "docs"]);
  });

  it("I4 takes a definition's <address> with \\> in it past what the parser has reached", () => {
    const defined = "[a]: <https://x.y/a\\>b.png>";
    const view = parsedShort("![a]", defined);

    expect(syntaxTree(view.state).length).toBeLessThan(view.state.doc.length - defined.length);
    expect(view.dom.querySelector("img.cm-image")?.getAttribute("src")).toBe("https://x.y/a>b.png");
  });

  it.each([
    ["in a fence", "```\n[docs]: https://evil.example\n```"],
    ["continuing a paragraph", "some text\n[docs]: https://x.example"],
  ])("A3 takes no definition %s past what the parser has reached", (_, tail) => {
    const ok = "[ok]: https://ok.example";
    const view = parsedShort("see [docs] and [ok] here", `${tail}\n\n${ok}`);
    const end = view.state.doc.length - tail.length - ok.length - 2;

    expect(syntaxTree(view.state).length).toBeLessThan(end);
    expect(drawn(lineOf(view, 2))).toEqual(["see [docs] and ok here", "ok"]);
  });

  it("A3 takes definitions under frontmatter, in a callout and in a list item", () => {
    const doc = [
      "---",
      "id: x",
      "---",
      "intro",
      "",
      "> [!note] T",
      ">",
      "> [a]: https://a.example",
      "",
      "- item",
      "",
      "  [b]: https://b.example",
      "",
      "see [a] and [b] here",
    ].join("\n");
    const view = mount(doc, plain(null));
    const last = [...view.contentDOM.querySelectorAll(".cm-line")].at(-1) as Element;

    expect(view.contentDOM.textContent).toContain("[a]: https://a.example");
    expect(view.contentDOM.textContent).toContain("[b]: https://b.example");
    expect({
      text: last.textContent,
      links: [...last.querySelectorAll(".cm-link")].map((link) => link.textContent),
    }).toEqual({ text: "see a and b here", links: ["a", "b"] });
  });

  it.each([
    ["full", "vim on", "see [the docs][docs] here", "see the docs here", "the docs", true],
    ["full", "vim off", "see [the docs][docs] here", "see the docs here", "the docs", false],
    ["collapsed", "vim on", "see [docs][] here", "see docs here", "docs", true],
    ["collapsed", "vim off", "see [docs][] here", "see docs here", "docs", false],
  ] as const)("A6 draws a %s reference as a link: %s", (_, __, doc, shown, text, vimOn) => {
    const line = lineOf(mount(`intro\n\n${doc}\n\n${DEFINED}`, preview(vimOn)), 2);

    expect(drawn(line)).toEqual([shown, text]);
  });

  it.each(VIM)(
    "A7 keeps the brackets of an undefined [text] beside a defined one: %s",
    (_, vimOn) => {
      const view = mount(
        `intro\n\nsee [text] here\n\nsee [docs] here\n\n${DEFINED}`,
        preview(vimOn),
      );

      expect(lineOf(view, 2).textContent).toBe("see [text] here");
      expect(lineOf(view, 2).querySelector(".cm-link")).toBeNull();
      expect(lineOf(view, 4).textContent).toBe("see docs here");
    },
  );

  it.each(VIM)("A8 leaves the definition line as typed: %s", (_, vimOn) => {
    const view = mount(`intro\n\nsee [docs] here\n\n${DEFINED}`, preview(vimOn));

    expect(lineOf(view, 4).textContent).toBe(DEFINED);
    expect(lineOf(view, 2).textContent).toBe("see docs here");
  });

  it.each(VIM)("I1 shows the source with the cursor in the link: %s", async (_, vimOn) => {
    const doc = `intro\n\nsee [docs] here\n\n${DEFINED}`;
    const view = mount(doc, preview(vimOn), doc.indexOf("docs"));
    // Vim's normal mode shows no link's source, an inline one's neither;
    // insert mode does.
    if (vimOn) fireEvent.keyDown(view.contentDOM, { key: "i" });

    await waitFor(() => expect(lineOf(view, 2).textContent).toBe("see [docs] here"));
    expect(lineOf(view, 2).querySelector(".cm-link")?.textContent).toBe("docs");
  });

  it("I3 keeps [text][label] as typed when only text is defined", () => {
    const doc = `intro\n\nsee [docs][label] here\n\nsee [docs] here\n\n${DEFINED}`;
    const view = mount(doc, plain(null));

    expect(lineOf(view, 2).textContent).toBe("see [docs][label] here");
    expect(lineOf(view, 2).querySelector(".cm-link")).toBeNull();
    expect(lineOf(view, 4).textContent).toBe("see docs here");
  });

  it("I4 takes no definition from a fenced code block", () => {
    const doc = `intro\n\nsee [code] here\n\n\`\`\`\n[code]: https://example.com\n\`\`\`\n\nsee [docs] here\n\n${DEFINED}`;
    const view = mount(doc, plain(null));

    // Counted from the end: the fence's own lines do not draw one apiece.
    const lines = view.contentDOM.querySelectorAll(".cm-line");

    expect(lineOf(view, 2).textContent).toBe("see [code] here");
    expect(lineOf(view, 2).querySelector(".cm-link")).toBeNull();
    expect(lines[lines.length - 3]?.textContent).toBe("see docs here");
  });

  it("I4 takes no definition into a markdown fence from outside it", async () => {
    // The fence's markdown parses as markdown only once that language loads.
    await LanguageDescription.matchLanguageName(languages, "md", true)?.load();
    const doc = `intro\n\n${DEFINED}\n\n\`\`\`md\nsee [docs] there\n\`\`\`\n\nsee [docs] here`;
    const view = mount(doc, plain(null));
    const lines = [...view.contentDOM.querySelectorAll(".cm-line")];
    const fence = lines.find((line) => line.textContent?.includes("there")) as Element;

    expect({ fence: drawn(fence), outside: drawn(lines.at(-1) as Element) }).toEqual({
      fence: ["see [docs] there", undefined],
      outside: ["see docs here", "docs"],
    });
  });

  it("keeps a footnote's brackets though its label is defined", () => {
    const doc = `intro\n\nclaim[^1] and [docs]\n\n[^1]: https://source.example\n\n${DEFINED}`;
    const line = lineOf(mount(doc, plain(null)), 2);

    expect(drawn(line)).toEqual(["claim[^1] and docs", "docs"]);
  });

  it("I5 draws a reference link in a table cell as a link", () => {
    const doc = `intro\n\n| a |\n| - |\n| [docs] |\n\n${DEFINED}`;
    const view = mount(doc, plain(null));
    const table = view.dom.querySelector(".cm-table-grid") as HTMLTableElement;

    expect(drawn(table.querySelector("tbody td") as Element)).toEqual(["docs", "docs"]);
  });

  it("I8 leaves a defined [x] in a todo's box to the todo", () => {
    const doc =
      "intro\n\n- [x] done\n- [/] doing\n\nsee [x] here\n\n[x]: https://example.com\n\n[/]: https://example.com";
    const view = mount(doc, plain(null));

    expect(lineOf(view, 2).textContent).toBe("done");
    expect(lineOf(view, 3).textContent).toBe("doing");
    expect(view.contentDOM.querySelector(".cm-todo-done")).not.toBeNull();
    expect(view.contentDOM.querySelector(".cm-todo-doing")).not.toBeNull();
    expect(lineOf(view, 5).textContent).toBe("see x here");
  });
});
