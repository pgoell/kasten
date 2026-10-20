import { page } from "vitest/browser";
import {
  act,
  appWith,
  BOTH,
  followedNote,
  landed,
  mountApp,
  openedOnly,
  PRESSES,
  phone,
  press,
  SITE,
  settled,
  stubOpen,
  tabled,
  tableLinkCleanup,
  tap,
  VIMS,
} from "./table-link-fixture";

tableLinkCleanup();

/** A table with no outer pipes whose first cell is a link, and a schemeless one in its body (#565). */
const SCHEMELESS = tabled(
  [
    "A table",
    "",
    "[p](https://p.com)",
    "",
    "[h](https://h.com) | b",
    "--- | ---",
    "[x](notes.md) | c",
  ],
  "[h]",
);

describe("a tap or a press on a link in a table cell", () => {
  // A table with no outer pipes starts with its first cell, so the editor's
  // own tap and ctrl+click, reading the link off the block's start, find the
  // header's link there. The block keeps a ctrl press from them at the press
  // and a tap at its click.
  it.each(["tap", "ctrl press"] as const)(
    "B1 a %s on link text in a cell of a table whose first cell is a link opens only that link",
    async (how) => {
      const doc = [
        "A table",
        "",
        "[h](https://h.com) | b",
        "--- | ---",
        `[text](${SITE}) | c`,
      ].join("\n");
      if (how === "tap") await phone();
      else await page.viewport(1280, 900);
      const host = mountApp(doc, how === "tap" ? 896 : 900);
      await expect.poll(() => host.querySelector(".cm-table-block tbody .cm-link")).not.toBeNull();
      const block = host.querySelector(".cm-table-block") as Element;
      const open = stubOpen();

      const text = block.querySelector("tbody .cm-link") as Element;
      if (how === "tap") await tap(text);
      else await press(text, 2);
      await expect
        .poll(() => open.mock.calls.length > 0 || !block.isConnected, {
          message: "the press landing",
        })
        .toBe(true);
      await settled();
      expect.soft(block.isConnected, "the table stays drawn").toBe(true);
      expect(open).toHaveBeenCalledExactlyOnceWith(SITE, "_blank", "noopener");
    },
  );
});

describe("a tap or a press on a link in a table cell opens its own target", () => {
  // Holds on main as well: the block's click opens the table, which takes the
  // tapped span off the page, and CodeMirror then drops the click before the
  // editor's tap can open what it read off the block's start.
  it.each(VIMS)(
    "A1 #565 a tap on a schemeless link in a table whose first cell is a link with vim %s opens nothing and shows the source",
    async (vim) => {
      const { at, block, element } = await appWith(SCHEMELESS.doc, "tap", vim, "tbody .cm-link");
      const follow = vi.fn();
      const open = stubOpen();

      await act(element, "tap");
      await openedOnly(at, SCHEMELESS.from, block, follow, open);
    },
  );

  it.each(PRESSES)(
    "A2 #565 a %s press on a schemeless link in a table whose first cell is a link with vim %s opens nothing",
    async (how, vim) => {
      const { at, block, element } = await appWith(SCHEMELESS.doc, how, vim, "tbody .cm-link");
      const follow = vi.fn();
      const open = stubOpen();

      await act(element, how);
      await openedOnly(at, SCHEMELESS.from, block, follow, open);
    },
  );

  // Guard: #563 made each of these follow, the block keeping the editor's
  // reading of the block's start from it.
  it.each(
    BOTH.flatMap(([how, vim]) =>
      (["header", "body"] as const).map((cell) => [how, cell, vim] as const),
    ),
  )(
    "A3 guard a %s on the %s link of a table with no outer pipes with vim %s opens its own address once",
    async (how, cell, vim) => {
      const doc = [
        "A table",
        "",
        "[p](https://p.com)",
        "",
        "[one](https://one.com) | b",
        "--- | ---",
        "c | [two](https://two.com)",
      ].join("\n");
      const { at, block } = await appWith(doc, how, vim, "tbody .cm-link");
      const follow = vi.fn();
      const open = stubOpen();

      await act(
        block.querySelector(`${cell === "header" ? "thead" : "tbody"} .cm-link`) as Element,
        how,
      );
      await landed(at, block, follow, open);
      expect.soft(block.isConnected, "the table stays drawn").toBe(true);
      expect.soft(follow, "no note followed").not.toHaveBeenCalled();
      const address = cell === "header" ? "https://one.com" : "https://two.com";
      expect(open).toHaveBeenCalledExactlyOnceWith(address, "_blank", "noopener");
    },
  );

  it.each(BOTH)(
    "A4 #565 a %s on the body wikilink of a table whose first cell is a wikilink with vim %s opens that note once",
    async (how, vim) => {
      const doc = ["A table", "", "[[First]] | b", "--- | ---", "[[Second]] | c"].join("\n");
      const follow = vi.fn();
      const { at, block, element } = await appWith(doc, how, vim, "tbody .cm-wikilink", {
        onFollow: follow,
      });
      const open = stubOpen();

      await act(element, how);
      await followedNote(at, block, follow, open, "Second");
    },
  );
});
