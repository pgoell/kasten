import { EditorView } from "@codemirror/view";
import { act, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { Editor } from "@/components/editor";
import { Outline as OutlineRows } from "@/components/note/note-margins";
import type { Outline } from "@/lib/notes/note/head/note-head";
import { ATX, LONG_NOTE, SETTLE_MS } from "@/lib/notes/note/head/note-outline";

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

describe("#1905 an outline heading before a long run of blanks", () => {
  it("reads in linear time", () => {
    // A heading text, 40,000 blanks, then a word; main's ran for minutes.
    const start = performance.now();
    ATX.exec(`# a${" ".repeat(40_000)}x`);
    ATX.exec(`# a${" ".repeat(40_000)}#x`);
    expect(performance.now() - start).toBeLessThan(200);
  });

  // The fix moves no heading on a normal line, and blanks-only words are one blank.
  it.each([
    ["## Second", "Second"],
    ["## Second ##", "Second"],
    ["##\tSecond\t#\t", "Second"],
    ["# Hello # world", "Hello # world"],
    ["# Hello# ##", "Hello#"],
    ["# Second  \r", "Second"],
    ["#    ", " "],
    ["#   \r", " "],
    ["####### Seven", undefined],
  ])("reads %j as on main", (line, words) => {
    expect(ATX.exec(line)?.[2]).toBe(words);
  });
});

describe("#1908 an outline heading after a long run of blanks or closing hashes", () => {
  // A run before the words then a mid-line `\r`, and a run of closing hashes then a word; main's took seconds.
  it.each([
    ["leading blanks", `##${" ".repeat(40_000)}a\rb`],
    ["closing hashes", `# a${" ".repeat(40_000)}${"#".repeat(50_000)}x`],
  ])("reads %s in linear time", (_, line) => {
    const start = performance.now();
    ATX.exec(line);
    expect(performance.now() - start).toBeLessThan(200);
  });

  it.each([
    ["# ###", "#"],
    ["# a##", "a"],
    ["# a#b ##", "a#b"],
    ["# ## #x", "## #x"],
    ["#  \r\n", " "],
  ])("reads %j as on main", (line, words) => {
    expect(ATX.exec(line)?.[2]).toBe(words);
  });
});

describe("#2329 a key typed in a long note", () => {
  // Past LONG_NOTE, so the header and the outline wait for the typing to pause.
  const filler = "Some filler words here.\n\n".repeat(Math.ceil(LONG_NOTE / 25));
  const LONG = `---\ntags: [one]\n---\n${SECTIONS}${filler}`;

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  function long(onOutline = vi.fn(), onChange = vi.fn()) {
    const { container, unmount } = render(
      <Editor initialDoc={LONG} path={PATH} onOutline={onOutline} onChange={onChange} />,
    );
    const view = EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement);
    if (view === null) throw new Error("no editor");
    const meta = () => container.querySelector("[data-head='meta']")?.textContent ?? "";
    const type = (keys: string, at = view.state.doc.length) => {
      for (const [index, key] of [...keys].entries()) {
        act(() =>
          view.dispatch({ changes: { from: at + index, insert: key }, userEvent: "input.type" }),
        );
      }
    };
    return { container, unmount, view, meta, type, onOutline, onChange };
  }

  it.each(["off", "on"])(
    "reads the header and the outline once the typing pauses, not on each key, vim %s",
    (vim) => {
      localStorage.setItem("kasten.vim", vim);
      const { container, meta, type, onOutline } = long();
      const words = meta();
      const reports = onOutline.mock.calls.length;

      type("\n## Late #fresh");

      expect(meta()).toBe(words);
      expect(onOutline.mock.calls.length).toBe(reports);
      // The Read and Edit switch reads no note, so it still follows at once.
      const read = [...container.querySelectorAll("button")].find((b) => b.textContent === "Read");
      act(() => read?.click());
      expect(read?.getAttribute("aria-pressed")).toBe("true");

      act(() => vi.advanceTimersByTime(SETTLE_MS));
      expect(meta()).not.toBe(words);
      expect(meta()).toContain("#fresh");
      expect(onOutline.mock.calls.length).toBe(reports + 1);
      expect(lastOutline(onOutline)?.headings.map(({ text }) => text)).toContain("Late #fresh");
    },
  );

  it("a jump right after a key lands on the heading its row shows, before the read", () => {
    const { view, type, onOutline } = long();

    type("abc", LONG.indexOf("text"));
    act(() => lastOutline(onOutline)?.jump(2));

    const head = view.state.selection.main.head;
    expect(view.state.doc.lineAt(head).text).toBe("## Three");
  });

  it("a jump, a scroll and a cursor move after a delete of headings stay in the doc", () => {
    const { view, onOutline } = long();
    const jump = lastOutline(onOutline)?.jump;

    act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length - 10 } }));
    act(() => jump?.(2));
    act(() => view.scrollDOM.dispatchEvent(new Event("scroll")));
    act(() => view.dispatch({ selection: { anchor: 0 } }));
    act(() => vi.advanceTimersByTime(SETTLE_MS));

    expect(view.state.selection.main.head).toBeLessThanOrEqual(view.state.doc.length);
    expect(lastOutline(onOutline)?.headings).toEqual([]);
  });

  it("a view closed while a read waits reads nothing after", () => {
    const { unmount, type, onOutline } = long();

    type("\n# Gone");
    const reports = onOutline.mock.calls.length;
    unmount();

    expect(() => act(() => vi.advanceTimersByTime(SETTLE_MS))).not.toThrow();
    expect(onOutline.mock.calls.length).toBe(reports);
  });

  it("every key of a fast run reaches onChange", () => {
    const { type, onChange } = long();

    type("abcdefghijklmnopqrst");

    expect(onChange).toHaveBeenCalledTimes(20);
    expect(onChange.mock.calls.at(-1)?.[0]).toBe(`${LONG}abcdefghijklmnopqrst`);
  });
});
