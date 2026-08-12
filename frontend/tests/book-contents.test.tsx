import { fireEvent, render, screen } from "@testing-library/react";
import { BookContents, type TocRow, tocRows } from "@/components/book-contents";

describe("the walk over a book's contents", () => {
  it("answers one row per entry, in reading order", () => {
    const rows = tocRows([
      { label: "One", href: "ch1.xhtml" },
      {
        label: "Two",
        href: "ch2.xhtml",
        subitems: [
          { label: "Two a", href: "ch2.xhtml#a" },
          { label: "Two b", href: "ch2.xhtml#b" },
        ],
      },
      { label: "Three", href: "ch3.xhtml" },
    ]);

    // A child follows its parent rather than the whole level being collected
    // first, which is the order a reader expects and the order `flatten` in
    // `progress.js:12-16` walks the same tree in.
    expect(rows.map((row) => row.label)).toEqual(["One", "Two", "Two a", "Two b", "Three"]);
  });

  it("counts the depth from the walk, uncapped", () => {
    const rows = tocRows([
      {
        label: "One",
        href: "a",
        subitems: [
          {
            label: "Two",
            href: "b",
            subitems: [{ label: "Three", href: "c", subitems: [{ label: "Four", href: "d" }] }],
          },
        ],
      },
    ]);

    expect(rows.map((row) => row.depth)).toEqual([0, 1, 2, 3]);
  });

  it("carries the id foliate stamped on the item", () => {
    // What the cursor's starting row is found by, matched against
    // `lastLocation.tocItem.id`.
    const rows = tocRows([{ id: 4, label: "One", href: "a" }]);

    expect(rows[0]?.id).toBe(4);
  });

  it("answers no rows for each of the three empty shapes", () => {
    // All three are reachable: `epub.js:1002-1019` leaves the field unset,
    // `epub.js:332-335` and `epub.js:361-364` set it null, and a publisher can
    // write the list and leave it empty.
    expect(tocRows(undefined)).toEqual([]);
    expect(tocRows(null)).toEqual([]);
    expect(tocRows([])).toEqual([]);
  });

  it("walks a leaf whichever way the book spelled it", () => {
    // Both parsers answer `subitems: null` on a leaf (`epub.js:328,356`), and
    // the missing key costs nothing to survive.
    const rows = tocRows([
      { label: "One", href: "a", subitems: null },
      { label: "Two", href: "b" },
    ]);

    expect(rows.map((row) => row.label)).toEqual(["One", "Two"]);
  });

  it("keeps a row the book gave nowhere to go", () => {
    // A book writes "Part One" as a heading with nothing to open
    // (`epub.js:319-321`), and the row still names a part of the book.
    const rows = tocRows([{ label: "Part One", href: null }, { label: "Part Two" }]);

    expect(rows.map((row) => row.href)).toEqual([null, null]);
  });

  it("shows the href where the book gave no label", () => {
    // Falsiness and not `=== ""`: the ncx gives `""` (`epub.js:352`) and the
    // nav path gives null or undefined (`epub.js:322`).
    const rows = tocRows([{ label: "", href: "a" }, { label: null, href: "b" }, { href: "c" }]);

    expect(rows.map((row) => row.label)).toEqual(["a", "b", "c"]);
  });

  it("drops an entry that gave neither a label nor a link", () => {
    const rows = tocRows([{ label: "One", href: "a" }, {}]);

    expect(rows).toHaveLength(1);
  });

  it("keeps the children of an entry it dropped", () => {
    // The nav parser answers exactly this shape for an `<li>` holding only a
    // nested `<ol>` (`epub.js:318-328`), so a walk that returned early here
    // would delete every chapter of a part from the list.
    const rows = tocRows([
      {
        subitems: [
          { label: "One", href: "a" },
          { label: "Two", href: "b" },
        ],
      },
    ]);

    expect(rows.map((row) => row.label)).toEqual(["One", "Two"]);
    // The depth they were found at. Indent is decoration and a chapter is not,
    // so nothing shifts up to fill the gap.
    expect(rows.map((row) => row.depth)).toEqual([1, 1]);
  });
});

/** A row of the contents, with the label doubling as the href. */
function row(label: string, extra: Partial<TocRow> = {}): TocRow {
  return { id: undefined, label, href: `${label}.xhtml`, depth: 0, ...extra };
}

const CHAPTERS = [row("One"), row("Two"), row("Three")];

function drawContents(rows: TocRow[], start = 0) {
  const onGo = vi.fn();
  const onClose = vi.fn();

  const drawn = render(<BookContents rows={rows} start={start} onGo={onGo} onClose={onClose} />);
  const dialog = screen.getByRole("dialog");

  return {
    ...drawn,
    onGo,
    onClose,
    dialog,
    press: (key: string) => fireEvent.keyDown(dialog, { key }),
    options: () => screen.queryAllByRole("option"),
    labels: () => screen.queryAllByRole("option").map((option) => option.textContent),
    highlighted: () => screen.queryByRole("option", { selected: true })?.textContent,
    hint: () => screen.getByRole("status").textContent,
  };
}

describe("the contents over a book", () => {
  it("draws one row per entry, in the order it was given", () => {
    const contents = drawContents(CHAPTERS);

    expect(contents.labels()).toEqual(["One", "Two", "Three"]);
  });

  it("indents a nested row rather than numbering it", () => {
    // The exact rems, because the inline value replaces `ROW`'s own `px-3`
    // rather than adding to it, which is what makes a depth of 0 an ordinary
    // row. A prefix like `1.2.3` would invent a numbering the book has not got
    // and sit beside the one it has.
    const contents = drawContents([
      row("One"),
      row("Two", { depth: 1 }),
      row("Four", { depth: 3 }),
    ]);

    const padding = contents.options().map((option) => (option as HTMLElement).style.paddingLeft);
    expect(padding).toEqual(["0.75rem", "1.5rem", "3rem"]);
    expect(contents.labels()).toEqual(["One", "Two", "Four"]);
  });

  it("walks the list on j and k", () => {
    const contents = drawContents(CHAPTERS);

    contents.press("j");
    expect(contents.highlighted()).toBe("Two");

    contents.press("k");
    expect(contents.highlighted()).toBe("One");
  });

  it("moves the highlight on screen and not only in the aria", () => {
    // `ROW` carries layout and text size alone (`overlay-styles.ts:67`), so a
    // list wearing `aria-selected` and no colour has a cursor a screen reader
    // can find and a reader cannot.
    const contents = drawContents(CHAPTERS);

    contents.press("j");

    const [first, second] = contents.options();
    expect(first).not.toHaveClass("bg-one-hover");
    expect(second).toHaveClass("bg-one-hover");
  });

  it("stops at both ends rather than wrapping", () => {
    const contents = drawContents(CHAPTERS);

    contents.press("k");
    expect(contents.highlighted()).toBe("One");

    contents.press("j");
    contents.press("j");
    contents.press("j");
    expect(contents.highlighted()).toBe("Three");
  });

  it("goes to the highlighted chapter on Enter", () => {
    const contents = drawContents(CHAPTERS);

    contents.press("j");
    contents.press("Enter");

    expect(contents.onGo).toHaveBeenCalledTimes(1);
    expect(contents.onGo).toHaveBeenCalledWith("Two.xhtml");
  });

  it("goes to the chapter a click landed on", () => {
    const contents = drawContents(CHAPTERS);

    fireEvent.click(contents.options()[2] as HTMLElement);

    expect(contents.onGo).toHaveBeenCalledWith("Three.xhtml");
  });

  it("closes on Escape and goes nowhere", () => {
    const contents = drawContents(CHAPTERS);

    contents.press("Escape");

    expect(contents.onClose).toHaveBeenCalledTimes(1);
    expect(contents.onGo).not.toHaveBeenCalled();
  });

  it("stays open on a row the book gave nowhere to go", () => {
    // A part heading. Enter does nothing and the list stays up, so the next
    // press can land on a real chapter.
    const contents = drawContents([row("Part One", { href: null }), row("One")]);

    contents.press("Enter");

    expect(contents.onGo).not.toHaveBeenCalled();
    expect(contents.onClose).not.toHaveBeenCalled();
    expect(contents.options()).toHaveLength(2);
  });

  it("opens on the row it was told to start on", () => {
    const contents = drawContents([...CHAPTERS, row("Four"), row("Five")], 4);

    expect(contents.highlighted()).toBe("Five");
  });

  it("clamps a starting row that is out of the list", () => {
    // -1 is what a book with no current chapter answers, and it is the whole
    // fallback: the cursor starts at the top.
    const low = drawContents(CHAPTERS, -1);
    expect(low.highlighted()).toBe("One");
    low.unmount();

    expect(drawContents(CHAPTERS, 9).highlighted()).toBe("Three");
  });

  it("says so for a book whose publisher wrote no contents", () => {
    const contents = drawContents([]);

    expect(contents.options()).toHaveLength(0);
    expect(contents.hint()).toBe("this book has no contents");
  });

  it("answers nothing but Escape on an empty list", () => {
    // The clamp gives -1 with no rows, so an Enter reading `rows[cursor].href`
    // reads a property off undefined.
    const contents = drawContents([]);

    contents.press("j");
    contents.press("k");
    contents.press("Enter");
    expect(contents.onGo).not.toHaveBeenCalled();

    contents.press("Escape");
    expect(contents.onClose).toHaveBeenCalledTimes(1);
  });
});
