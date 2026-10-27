import { act, fireEvent, render } from "@testing-library/react";
import { Editor } from "@/components/editor";
import { toggleVim } from "@/lib/editor/vim-setting";
import { finishParsing, renderStarved } from "./parsing";

describe("Editor following a link inside bold or another mark (#432)", () => {
  const ISSUE_LINE =
    '- [ ] Decide the scorer rules. **Read [[Scorer Rules]] first: one real example per rule, with a small "Power BI vs AI/BI" table.** **Output:** one answer per line, or "ok" to take every suggestion #internal ⏳ 2026-10-19 ➕ 2026-10-17 ⏲ 20m 🆔 kt-2726c0';
  const CASES = [
    ["bold in the issue's todo line (A1, A6)", ISSUE_LINE, "Scorer Rules", "Scorer Rules"],
    ["bold in a plain line (A1, A6)", "see **[[borges]]** now", "borges", "borges"],
    ["italic (A5)", "see *[[borges]]* now", "borges", "borges"],
    ["strikethrough (A5)", "see ~~[[borges]]~~ now", "borges", "borges"],
    ["highlight (A5)", "see ==[[borges]]== now", "borges", "borges"],
    ["bold, by its alias (I6)", "see **[[borges|Jorge]]** now", "Jorge", "borges|Jorge"],
  ];

  /**
   * The element holding the text, which is what a browser hands a click as its
   * target. Inside a mark that is a span nested in the link's own span, so a
   * test on `.cm-wikilink` would click somewhere no finger can.
   */
  function textIn(container: HTMLElement, text: string): HTMLElement {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (node.textContent?.includes(text)) return node.parentElement as HTMLElement;
    }
    throw new Error(`no text ${text}`);
  }

  afterEach(() => localStorage.clear());

  it.each(CASES)(
    "follows a link in %s on ctrl+click and cmd+click, vim on and off (A2, A3)",
    (_, doc, text, target) => {
      const onFollow = vi.fn();
      const { container } = render(<Editor initialDoc={`intro\n\n${doc}`} onFollow={onFollow} />);
      finishParsing(container);

      fireEvent.mouseDown(textIn(container, text), { ctrlKey: true });
      fireEvent.mouseDown(textIn(container, text), { metaKey: true });
      act(() => toggleVim());
      fireEvent.mouseDown(textIn(container, text), { ctrlKey: true });

      expect(onFollow.mock.calls).toEqual([[target], [target], [target]]);
    },
  );

  it.each(CASES)("follows a link in %s on a tap, vim on and off (A4)", (_, doc, text, target) => {
    const onFollow = vi.fn();
    const { container } = render(<Editor initialDoc={`intro\n\n${doc}`} onFollow={onFollow} />);
    finishParsing(container);
    const tap = () => {
      fireEvent.pointerDown(textIn(container, text), { pointerType: "touch" });
      fireEvent.click(textIn(container, text));
    };

    tap();
    act(() => toggleVim());
    tap();

    expect(onFollow.mock.calls).toEqual([[target], [target]]);
  });

  it("follows a link in italic on a tap when the first parse runs out of time (#618)", () => {
    const onFollow = vi.fn();
    const { container } = renderStarved(
      <Editor initialDoc={"intro\n\nsee *[[borges]]* now"} onFollow={onFollow} />,
    );
    finishParsing(container);
    const tap = () => {
      fireEvent.pointerDown(textIn(container, "borges"), { pointerType: "touch" });
      fireEvent.click(textIn(container, "borges"));
    };

    tap();
    act(() => toggleVim());
    tap();

    expect(onFollow.mock.calls).toEqual([["borges"], ["borges"]]);
  });

  it("opens a markdown link's address in bold on ctrl+click (I3)", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { container } = render(<Editor initialDoc="see **[mail](https://example.com/a)** now" />);
    finishParsing(container);

    fireEvent.mouseDown(textIn(container, "mail"), { ctrlKey: true });

    expect(open).toHaveBeenCalledWith("https://example.com/a", "_blank", "noopener");
    open.mockRestore();
  });

  it("leaves a plain click on a link in bold to the cursor (I4)", () => {
    const onFollow = vi.fn();
    const { container } = render(
      <Editor initialDoc="see **[[borges]]** now" onFollow={onFollow} />,
    );
    finishParsing(container);

    fireEvent.mouseDown(textIn(container, "borges"));

    expect(onFollow).not.toHaveBeenCalled();
  });

  it("leaves a tap on a link in bold the cursor sits in to the cursor (I5)", () => {
    const onFollow = vi.fn();
    const { container } = render(
      <Editor initialDoc={"intro\n\nsee **[[borges]]** now"} onFollow={onFollow} />,
    );
    finishParsing(container);
    const content = container.querySelector(".cm-content") as HTMLElement;
    const tap = () => {
      fireEvent.pointerDown(textIn(container, "borges"), { pointerType: "touch" });
      fireEvent.click(textIn(container, "borges"));
    };

    // The first tap, from outside the link, shows the second one is turned
    // away by the cursor and not by the mark.
    tap();
    for (const key of ["G", "0", "f", "b"]) fireEvent.keyDown(content, { key });
    tap();

    expect(onFollow.mock.calls).toEqual([["borges"]]);
  });

  it.each([
    ["a plain line", "see [text] here"],
    ["bold", "see **[text]** here"],
  ])("opens nothing on ctrl+click, cmd+click or a tap on a [text] in %s (#441)", (_, doc) => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const onFollow = vi.fn();
    const { container } = render(<Editor initialDoc={`intro\n\n${doc}`} onFollow={onFollow} />);
    finishParsing(container);

    fireEvent.mouseDown(textIn(container, "text"), { ctrlKey: true });
    fireEvent.mouseDown(textIn(container, "text"), { metaKey: true });
    fireEvent.pointerDown(textIn(container, "text"), { pointerType: "touch" });
    fireEvent.click(textIn(container, "text"));

    expect(open).not.toHaveBeenCalled();
    expect(onFollow).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it("opens a markdown link's address on a tap (#441)", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { container } = render(
      <Editor initialDoc={"intro\n\nsee [mail](https://example.com/a) now"} />,
    );
    finishParsing(container);

    fireEvent.pointerDown(textIn(container, "mail"), { pointerType: "touch" });
    fireEvent.click(textIn(container, "mail"));

    expect(open).toHaveBeenCalledWith("https://example.com/a", "_blank", "noopener");
    open.mockRestore();
  });

  const OPENED = ["https://example.com/a", "_blank", "noopener"];

  it.each([
    ["a shortcut (A4)", "see [docs] here", "docs"],
    ["a full (A6)", "see [the docs][docs] here", "the docs"],
    ["a collapsed (A6)", "see [docs][] here", "docs"],
  ])(
    "opens %s reference link's address on ctrl+click and cmd+click, vim on and off",
    (_, doc, text) => {
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      const { container } = render(
        <Editor initialDoc={`intro\n\n${doc}\n\n[docs]: https://example.com/a`} />,
      );
      finishParsing(container);

      fireEvent.mouseDown(textIn(container, text), { ctrlKey: true });
      fireEvent.mouseDown(textIn(container, text), { metaKey: true });
      act(() => toggleVim());
      fireEvent.mouseDown(textIn(container, text), { ctrlKey: true });

      expect(open.mock.calls).toEqual([OPENED, OPENED, OPENED]);
      open.mockRestore();
    },
  );

  it.each([
    ["a shortcut (A5)", "see [docs] here", "docs"],
    ["a full (A6)", "see [the docs][docs] here", "the docs"],
    ["a collapsed (A6)", "see [docs][] here", "docs"],
  ])("opens %s reference link's address on a tap, vim on and off", (_, doc, text) => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { container } = render(
      <Editor initialDoc={`intro\n\n${doc}\n\n[docs]: https://example.com/a`} />,
    );
    finishParsing(container);
    const tap = () => {
      fireEvent.pointerDown(textIn(container, text), { pointerType: "touch" });
      fireEvent.click(textIn(container, text));
    };

    tap();
    act(() => toggleVim());
    tap();

    expect(open.mock.calls).toEqual([OPENED, OPENED]);
    open.mockRestore();
  });

  it("opens no javascript:, data: or vbscript: address on ctrl+click or a tap (#548)", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const doc = [
      "intro",
      "",
      "see [safe] and [inline](javascript:alert(1)) and [ref] and [data] and [vb] here",
      "",
      "[safe]: https://example.com/a",
      "",
      "[ref]: JavaScript:alert(1)",
      "",
      "[data]: data:text/html,x",
      "",
      "[vb]: vbscript:x",
    ];
    const { container } = render(<Editor initialDoc={doc.join("\n")} />);
    finishParsing(container);
    const both = (text: string) => {
      fireEvent.mouseDown(textIn(container, text), { ctrlKey: true });
      fireEvent.pointerDown(textIn(container, text), { pointerType: "touch" });
      fireEvent.click(textIn(container, text));
    };

    both("safe");
    expect(open.mock.calls).toEqual([OPENED, OPENED]);
    for (const text of ["inline", "ref", "data", "vb"]) both(text);

    expect(open.mock.calls).toEqual([OPENED, OPENED]);
    open.mockRestore();
  });

  it("opens nothing on a plain click on a reference link (I1)", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { container } = render(
      <Editor initialDoc={"intro\n\nsee [docs] here\n\n[docs]: https://example.com/a"} />,
    );
    finishParsing(container);

    fireEvent.mouseDown(textIn(container, "docs"));
    expect(open).not.toHaveBeenCalled();
    fireEvent.mouseDown(textIn(container, "docs"), { ctrlKey: true });

    expect(open.mock.calls).toEqual([OPENED]);
    open.mockRestore();
  });

  it("leaves a tap on a reference link the cursor sits in to the cursor (I2)", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { container } = render(
      <Editor initialDoc={"[docs]: https://example.com/a\n\nsee [Docs] here"} />,
    );
    finishParsing(container);
    const content = container.querySelector(".cm-content") as HTMLElement;
    // `Docs` rather than `docs`, which the definition above spells first.
    const tap = () => {
      fireEvent.pointerDown(textIn(container, "Docs"), { pointerType: "touch" });
      fireEvent.click(textIn(container, "Docs"));
    };

    // The first tap, from outside the link, shows the second one is turned
    // away by the cursor and not by the link.
    tap();
    for (const key of ["G", "0", "f", "D"]) fireEvent.keyDown(content, { key });
    tap();

    expect(open.mock.calls).toEqual([OPENED]);
    open.mockRestore();
  });

  // Spelled out rather than `OPENED`, so the test runs as it stands on the
  // code before #546, where it was seen failing.
  const BRACKETED = ["https://example.com", "_blank", "noopener"];

  it("A1 opens [a](<https://example.com>) on ctrl+click and cmd+click, vim on and off (#446)", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { container } = render(
      <Editor initialDoc={"intro\n\nsee [a](<https://example.com>) now"} />,
    );
    finishParsing(container);

    fireEvent.mouseDown(textIn(container, "a"), { ctrlKey: true });
    fireEvent.mouseDown(textIn(container, "a"), { metaKey: true });
    act(() => toggleVim());
    fireEvent.mouseDown(textIn(container, "a"), { ctrlKey: true });

    expect(open.mock.calls).toEqual([BRACKETED, BRACKETED, BRACKETED]);
    open.mockRestore();
  });

  it("A2 opens [a](<https://example.com>) on a tap, vim on and off (#446)", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { container } = render(
      <Editor initialDoc={"intro\n\nsee [a](<https://example.com>) now"} />,
    );
    finishParsing(container);
    const tap = () => {
      fireEvent.pointerDown(textIn(container, "a"), { pointerType: "touch" });
      fireEvent.click(textIn(container, "a"));
    };

    tap();
    act(() => toggleVim());
    tap();

    expect(open.mock.calls).toEqual([BRACKETED, BRACKETED]);
    open.mockRestore();
  });

  it.each([
    ["a bare address", "see [a](https://x.y/a\\)b) now", "https://x.y/a)b"],
    ["a definition's <address>", "see [a] now\n\n[a]: <https://x.y/a\\>b>", "https://x.y/a>b"],
  ])("I4 opens %s with its backslash escape undone (#447)", (_, doc, address) => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { container } = render(<Editor initialDoc={`intro\n\n${doc}`} />);
    finishParsing(container);

    fireEvent.mouseDown(textIn(container, "a"), { ctrlKey: true });

    expect(open.mock.calls).toEqual([[address, "_blank", "noopener"]]);
    open.mockRestore();
  });
});
