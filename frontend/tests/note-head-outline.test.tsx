import { EditorView } from "@codemirror/view";
import { act, render } from "@testing-library/react";
import { Editor } from "@/components/editor";
import type { Outline } from "@/lib/note/note-head";

const PATH = "02 Projects/Kasten/Reader.md";
// The fenced `#` line is code, and the closing hashes of the last heading are not its words.
const DOC = "---\ntype: Concept\n---\n# Top\n\n```\n# inside code\n```\n\n## Second ##\n";

/** The outline the editor reported last, or undefined where it reported none. */
function lastOutline(onOutline: ReturnType<typeof vi.fn>): Outline | undefined {
  return onOutline.mock.calls.at(-1)?.[0] as Outline | undefined;
}

it("the outline lists the headings below the frontmatter and skips fenced ones", () => {
  const onOutline = vi.fn();
  render(<Editor initialDoc={DOC} path={PATH} onOutline={onOutline} />);

  const headings = (lastOutline(onOutline)?.headings ?? []).map(({ level, text, line }) => [
    level,
    text,
    line,
  ]);
  expect(headings).toEqual([
    [1, "Top", 4],
    [2, "Second", 10],
  ]);
});

it("jump puts the cursor on the heading", () => {
  const onOutline = vi.fn();
  const { container } = render(<Editor initialDoc={DOC} path={PATH} onOutline={onOutline} />);
  const view = EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement);

  act(() => lastOutline(onOutline)?.jump(1));

  // The line and not the offset: vim's normal mode settles the cursor on a character of it.
  const head = view?.state.selection.main.head ?? -1;
  expect(view?.state.doc.lineAt(head).text).toBe("## Second ##");
  expect(lastOutline(onOutline)?.current).toBe(1);
});

it("the current section follows the cursor", () => {
  const onOutline = vi.fn();
  const { container } = render(
    <Editor
      initialDoc={"# One\n\ntext\n\n## Two\n\ntext\n\n## Three\n\ntext\n"}
      path={PATH}
      onOutline={onOutline}
    />,
  );
  const view = EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement);

  act(() =>
    view?.dispatch({ selection: { anchor: view.state.doc.toString().indexOf("## Three") } }),
  );

  expect(lastOutline(onOutline)?.current).toBe(2);
});
