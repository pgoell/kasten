import { ensureSyntaxTree, forceParsing } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { classHighlighter, highlightTree } from "@lezer/highlight";
import { render } from "@testing-library/react";
import { Editor } from "@/components/editor";

/** A note whose `---` on line 1 nothing closes. */
const UNCLOSED = "---\nref: x #abc\n\n#real";

function viewIn(container: HTMLElement): EditorView {
  const dom = container.querySelector<HTMLElement>(".cm-editor");
  const view = dom === null ? null : EditorView.findFromDOM(dom);
  if (view === null) throw new Error("no editor drawn");
  return view;
}

/**
 * Whether the live tree holds a frontmatter read as YAML, the fences it styles
 * as meta, and the tags it draws.
 */
function parsed(view: EditorView) {
  // The live parse runs for a bounded time, which a loaded machine can spend
  // before it reaches the last line; this carries the same parse on to the end.
  const tree = ensureSyntaxTree(view.state, view.state.doc.length, 5000);
  if (tree === null) throw new Error("the parse did not finish");
  const tags: string[] = [];
  let frontmatter = false;
  let yaml = false;
  tree.iterate({
    enter(node) {
      if (node.name === "Frontmatter") frontmatter = true;
      if (node.name === "Pair") yaml = true;
      if (node.name === "Tag") tags.push(view.state.sliceDoc(node.from, node.to));
    },
  });
  const fences: string[] = [];
  highlightTree(tree, classHighlighter, (from, to, classes) => {
    if (classes.split(" ").includes("tok-meta")) fences.push(view.state.sliceDoc(from, to));
  });
  return { frontmatter, yaml, fences, tags };
}

const NONE = { frontmatter: false, yaml: false, fences: [], tags: ["#abc", "#real"] };

/** The text of every tag the editor coloured on the page, once the parse is done. */
function coloured(container: HTMLElement): string[] {
  const view = viewIn(container);
  forceParsing(view, view.state.doc.length, 5000);
  return [...container.querySelectorAll(".cm-tag")].map((node) => node.textContent ?? "");
}

afterEach(() => {
  localStorage.clear();
});

describe("#649 a frontmatter that never closes is no frontmatter", () => {
  it("#649 I2 typing the closing --- makes a frontmatter and deleting it unmakes one", () => {
    const { container } = render(<Editor initialDoc={UNCLOSED} />);
    const view = viewIn(container);
    const at = "---\nref: x #abc\n".length;

    expect.soft(parsed(view)).toEqual(NONE);

    view.dispatch({ changes: { from: at, insert: "---\n" } });
    expect.soft(parsed(view)).toEqual({
      frontmatter: true,
      yaml: true,
      fences: ["---\n", "---\n"],
      tags: ["#real"],
    });

    view.dispatch({ changes: { from: at, to: at + "---\n".length } });
    expect(parsed(view)).toEqual(NONE);
  });

  it("#649 I3 the tags under an unclosed --- draw with vim on and with vim off", () => {
    localStorage.setItem("kasten.vim", "on");
    const on = render(<Editor initialDoc={UNCLOSED} />);
    expect.soft(coloured(on.container)).toContain("#real");
    on.unmount();

    localStorage.setItem("kasten.vim", "off");
    const off = render(<Editor initialDoc={UNCLOSED} />);
    expect(coloured(off.container)).toContain("#real");
  });
});
