import { tocRows } from "@/components/book-contents";

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
