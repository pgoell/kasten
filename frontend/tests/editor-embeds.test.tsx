import { syntaxTreeAvailable } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { act, render } from "@testing-library/react";
import { Editor } from "@/components/editor";
import { NotePreview } from "@/components/note/note-preview";
import { toggleVim } from "@/lib/notes/editor/vim-setting";
import { type EmbedSource, embedSource } from "@/lib/notes/embeds/embed";
import { starved } from "./parsing";

describe("Editor embeds", () => {
  function source(container: HTMLElement) {
    const view = EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement);
    return view?.state.facet(embedSource);
  }

  function embeds(): EmbedSource {
    return { watch: vi.fn(() => () => {}), open: vi.fn() };
  }

  afterEach(() => localStorage.clear());

  it("tells nothing about the vault to a view handed no source", () => {
    const { container } = render(<Editor initialDoc="hello" />);

    expect(source(container)).toBeNull();
  });

  it("carries the source it was handed, the latest one, through a vim toggle", () => {
    const first = embeds();
    const second = embeds();
    const { container, rerender } = render(<Editor initialDoc="hello" embeds={first} />);
    rerender(<Editor initialDoc="hello" embeds={second} />);
    act(() => toggleVim());

    const listener = vi.fn();
    source(container)?.watch("a.md", listener);
    source(container)?.open("a.md", 3);

    expect(second.watch).toHaveBeenCalledWith("a.md", listener);
    expect(second.open).toHaveBeenCalledWith("a.md", 3);
    expect(first.watch).not.toHaveBeenCalled();
  });
});

describe("an embedded note and the note preview past CodeMirror's first parse (#2324)", () => {
  // Thirty sections, so headings lie past what a starved first parse reaches.
  const PARTS = `Some words.\n\n${Array.from(
    { length: 30 },
    (_, i) => `## Part ${i + 1}\n\nA paragraph of words the parser walks through, line by line.\n`,
  ).join("\n")}`;

  /** The lines of `view` drawn on screen that still show a heading's `#`. */
  function rawHeadings(view: EditorView): string[] {
    return [...view.contentDOM.querySelectorAll(".cm-line")]
      .map((line) => line.textContent ?? "")
      .filter((text) => /^#{1,6} /.test(text));
  }

  function nested(container: HTMLElement): EditorView {
    const view = EditorView.findFromDOM(
      container.querySelector(".cm-embed .cm-editor") as HTMLElement,
    );
    if (view === null) throw new Error("no embed was drawn");
    return view;
  }

  /** A note that embeds Parts.md, its source answering with `text` and keeping the listener. */
  function embedding(text: string) {
    const listeners: ((text: string | null) => void)[] = [];
    const source: EmbedSource = {
      watch: (_target, listener) => {
        listeners.push(listener);
        listener(text);
        return () => {};
      },
      open: vi.fn(),
    };
    const ui = <Editor initialDoc="![[Parts]]\n" paths={["Parts.md"]} embeds={source} />;
    return { ui, listeners };
  }

  it("draws an embedded note's headings without their #", async () => {
    const { container } = starved(embedding(PARTS).ui);
    await act(async () => {});

    expect(rawHeadings(nested(container))).toEqual([]);
    expect(nested(container).contentDOM.textContent).toContain("Part 7");
  });

  it("draws an embedded note's headings without their # after a save elsewhere replaces its text", async () => {
    const { ui, listeners } = embedding("Short.");
    const { container } = render(ui);
    const real = Date.now.bind(Date);
    let now = real();
    const clock = vi.spyOn(Date, "now").mockImplementation(() => (now += 30));
    try {
      act(() => {
        for (const listener of listeners) listener(PARTS);
      });
    } finally {
      clock.mockRestore();
    }
    await act(async () => {});

    expect(rawHeadings(nested(container))).toEqual([]);
    expect(nested(container).contentDOM.textContent).toContain("Part 7");
  });

  it("draws the lines an embed scrolls onto without raw marks", async () => {
    const long = `${"A paragraph the parser walks through.\n\n".repeat(3000)}# Deep\n\nend`;
    const { container } = starved(embedding(long).ui);
    await act(async () => {});
    const view = nested(container);
    // The outer note's scroll moves the embed's viewport, as this does.
    act(() => view.dispatch({ effects: EditorView.scrollIntoView(long.length) }));
    await act(async () => {});

    expect(view.viewport.to).toBe(long.length);
    expect(rawHeadings(view)).toEqual([]);
    expect(view.contentDOM.textContent).toContain("Deep");
  });

  it("spends no parse on an embed gone before its parse runs", async () => {
    const { container, unmount } = starved(embedding(PARTS).ui);
    const view = nested(container);
    unmount();
    await act(async () => {});

    expect(syntaxTreeAvailable(view.state, PARTS.length)).toBe(false);
  });

  for (const mark of [undefined, 60]) {
    it(`draws the note preview's headings without their #, ${mark ? "at a hit far down" : "at the top"}`, async () => {
      const { container } = starved(<NotePreview text={PARTS} markLine={mark} />);
      await act(async () => {});
      const view = EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement);
      if (view === null) throw new Error("no preview was drawn");

      expect(rawHeadings(view)).toEqual([]);
      expect(view.contentDOM.textContent).toContain(mark ? "Part 20" : "Part 7");
    });
  }
});
