import { EditorView } from "@codemirror/view";
import { act, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { Editor } from "@/components/editor";
import { Outline as OutlineRows } from "@/components/note/note-margins";
import type { Outline } from "@/lib/notes/note/note-head";

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

/** The editor beside the outline it reports, as the note's margin draws them. */
function WithOutline({ doc }: { doc: string }) {
  const [outline, setOutline] = useState<Outline | undefined>(undefined);
  return (
    <>
      <Editor initialDoc={doc} path={PATH} onOutline={setOutline} />
      <OutlineRows outline={outline} />
    </>
  );
}

const SECTIONS = "# One\n\ntext\n\n## Two\n\ntext\n\n## Three\n\ntext\n";

function shown(container: HTMLElement) {
  const view = EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement);
  const rows = () => [...container.querySelectorAll<HTMLButtonElement>("nav button")];
  return { view, rows };
}

it("a keystroke above the headings keeps every outline row, and the rows still mean their heading (#988)", () => {
  const { container } = render(<WithOutline doc={SECTIONS} />);
  const { view, rows } = shown(container);
  const before = rows();

  for (const key of "abc") act(() => view?.dispatch({ changes: { from: 8, insert: key } }));

  expect(rows()).toHaveLength(3);
  expect(rows().every((row, index) => row === before[index])).toBe(true);
  act(() => view?.dispatch({ selection: { anchor: view.state.doc.toString().indexOf("## Two") } }));
  expect(rows().map((row) => row.getAttribute("aria-current"))).toEqual([null, "location", null]);
  fireEvent.click(rows()[2] as HTMLButtonElement);
  const head = view?.state.selection.main.head ?? -1;
  expect(view?.state.doc.lineAt(head).text).toBe("## Three");
});

it("a heading typed above the others shows the right text and indent in every row", () => {
  const { container } = render(<WithOutline doc={SECTIONS} />);
  const { view, rows } = shown(container);

  act(() => view?.dispatch({ changes: { from: 0, insert: "### Zero\n\n" } }));
  expect(rows().map((row) => [row.textContent, row.style.paddingLeft])).toEqual([
    ["Zero", "calc(var(--k-space-8) + 24px)"],
    ["One", "calc(var(--k-space-8) + 0px)"],
    ["Two", "calc(var(--k-space-8) + 12px)"],
    ["Three", "calc(var(--k-space-8) + 12px)"],
  ]);

  act(() => view?.dispatch({ changes: { from: 0, to: "### Zero\n\n".length } }));
  expect(rows().map((row) => row.textContent)).toEqual(["One", "Two", "Three"]);
});
