import { cdp, page } from "vitest/browser";
import { shot } from "./shots";
import {
  act,
  appWith,
  BOTH,
  followedNote,
  framed,
  landed,
  linkedIn,
  mountApp,
  on,
  openedOnly,
  PRESSES,
  phone,
  picture,
  SITE,
  settled,
  stubOpen,
  tableLinkCleanup,
  tap,
  tapAt,
  VIMS,
} from "./table-link-fixture";

tableLinkCleanup();

describe("a tap or a press on a link in a table cell opens its own target", () => {
  it.each(VIMS)(
    "A5 #564 a tap on a wikilink in a cell with vim %s opens its note once",
    async (vim) => {
      const { doc } = linkedIn("[[Some note]]");
      const follow = vi.fn();
      const { at, block, element } = await appWith(doc, "tap", vim, "tbody .cm-wikilink", {
        onFollow: follow,
      });
      const open = stubOpen();

      await act(element, "tap");
      await followedNote(at, block, follow, open, "Some note");
    },
  );

  it.each(PRESSES)(
    "A6 #564 a %s press on a wikilink in a cell with vim %s opens its note once",
    async (how, vim) => {
      const { doc } = linkedIn("[[Some note]]");
      const follow = vi.fn();
      const { at, block, element } = await appWith(doc, how, vim, "tbody .cm-wikilink", {
        onFollow: follow,
      });
      const open = stubOpen();

      await act(element, how);
      await followedNote(at, block, follow, open, "Some note");
    },
  );

  // A cell writes the alias bar `\|`, the backslash being the table's, so the
  // target handed on is what `[[note|Shown]]` on a plain line hands on.
  const ALIASED = {
    alias: ["[[note\\|Shown]]", "note|Shown"],
    heading: ["[[note#Head]]", "note#Head"],
    "heading and alias": ["[[note#Head\\|Shown]]", "note#Head|Shown"],
  } as const;

  it.each(
    BOTH.flatMap(([how, vim]) =>
      (Object.keys(ALIASED) as (keyof typeof ALIASED)[]).map((kind) => [how, kind, vim] as const),
    ),
  )(
    "A7 #564 a %s on a wikilink with %s in a cell with vim %s hands on the target a plain line does",
    async (how, kind, vim) => {
      const [link, target] = ALIASED[kind];
      const follow = vi.fn();
      const { at, block, element } = await appWith(
        linkedIn(link).doc,
        how,
        vim,
        "tbody .cm-wikilink",
        {
          onFollow: follow,
        },
      );
      const open = stubOpen();

      await act(element, how);
      await followedNote(at, block, follow, open, target);
    },
  );

  it.each(BOTH)(
    "A7 #564 a %s on a wikilink to a heading of this note in a cell with vim %s moves the cursor there",
    async (how, vim) => {
      const doc = [
        "A table",
        "",
        "# Head",
        "",
        "| a | b |",
        "| --- | --- |",
        "| [[#Head]] | c |",
      ].join("\n");
      const follow = vi.fn();
      const { at, block, element } = await appWith(doc, how, vim, "tbody .cm-wikilink", {
        onFollow: follow,
      });
      const open = stubOpen();

      await act(element, how);
      await landed(at, block, follow, open);
      expect.soft(block.isConnected, "the table stays drawn").toBe(true);
      expect.soft(follow, "no note followed").not.toHaveBeenCalled();
      expect.soft(open, "no tab opened").not.toHaveBeenCalled();
      // On its line rather than at its start: the hidden `# ` is stepped over.
      const line = at.state.doc.lineAt(at.state.selection.main.head);
      expect(line.text, "the cursor on the heading").toBe("# Head");
    },
  );

  // A look rather than a check, as A7 above is.
  const LOOK = [
    "A table",
    "",
    "| note | alias | link | dead |",
    "| --- | --- | --- | --- |",
    `| [[Some note]] | [[Some note\\|Shown]] | [text](${SITE}) | [[Nowhere]] |`,
    "| **[[Some note]]** | [[#Head]] | [x](notes.md) | plain |",
  ].join("\n");

  it("A8 a table with wikilinks and links on a phone", async () => {
    await phone();
    const host = mountApp(LOOK, 896, { vim: "on", paths: ["Some note.md"] });
    await expect.poll(() => host.querySelector(".cm-table-block .cm-wikilink-dead")).not.toBeNull();
    expect(await shot(host.querySelector(".cm-editor") as Element, "table-wikilink-phone")).toBe(
      414,
    );
  });

  it("A8 a table with wikilinks and links on a desktop", async () => {
    await page.viewport(1280, 900);
    const host = mountApp(LOOK, 900, { vim: "on", paths: ["Some note.md"] });
    await expect.poll(() => host.querySelector(".cm-table-block .cm-wikilink-dead")).not.toBeNull();
    expect(await shot(host.querySelector(".cm-editor") as Element, "table-wikilink-desktop")).toBe(
      1280,
    );
  });

  // Guard: a plain click in a link edits it off a table, and in one opens it.
  it.each(VIMS)(
    "I1 guard a plain press on a wikilink in a cell with vim %s opens the table",
    async (vim) => {
      const { doc, from } = linkedIn("[[Some note]]");
      const follow = vi.fn();
      const { at, block, element } = await appWith(doc, "plain", vim, "tbody .cm-wikilink", {
        onFollow: follow,
      });
      const open = stubOpen();

      await act(element, "plain");
      await openedOnly(at, from, block, follow, open);
    },
  );

  it.each(BOTH)(
    "I2 a %s on a dead wikilink in a cell with vim %s opens its note once",
    async (how, vim) => {
      const { doc } = linkedIn("[[Nowhere]]");
      const follow = vi.fn();
      const { at, block, element } = await appWith(doc, how, vim, "tbody .cm-wikilink-dead", {
        onFollow: follow,
        paths: ["Some note.md"],
      });
      const open = stubOpen();

      await act(element, how);
      await followedNote(at, block, follow, open, "Nowhere");
    },
  );

  it.each(BOTH)(
    "I3 a %s on a bold wikilink in a cell with vim %s opens its note once",
    async (how, vim) => {
      const { doc } = linkedIn("**[[Some note]]**");
      const follow = vi.fn();
      const { at, block, element } = await appWith(doc, how, vim, "tbody .cm-wikilink", {
        onFollow: follow,
      });
      const open = stubOpen();

      await act(element, how);
      await followedNote(at, block, follow, open, "Some note");
    },
  );

  // The cursor in a link is what keeps a tap from following it, and the one
  // the cursor is in here is another link that only shares the name.
  it.each(VIMS)(
    "I4 a tap on a wikilink in a cell with vim %s follows while the cursor rests in one of the same name",
    async (vim) => {
      const doc = ["[[Some note]]", "", "| a | b |", "| --- | --- |", "| [[Some note]] | c |"].join(
        "\n",
      );
      const follow = vi.fn();
      const { at, block, element } = await appWith(doc, "tap", vim, "tbody .cm-wikilink", {
        onFollow: follow,
      });
      at.dispatch({ selection: { anchor: 4 } });
      const open = stubOpen();

      await act(element, "tap");
      await followedNote(at, block, follow, open, "Some note", 4);
    },
  );

  // Guard: a scroll makes no click, inside a table or out.
  it.each(VIMS)(
    "I5 guard a finger that lands on a wikilink in a cell and drags with vim %s opens nothing",
    async (vim) => {
      const { doc } = linkedIn("[[Some note]]");
      const follow = vi.fn();
      const { at, element } = await appWith(doc, "tap", vim, "tbody .cm-wikilink", {
        onFollow: follow,
      });
      const open = stubOpen();

      const [x, y] = on(element);
      await cdp().send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (const step of [20, 40, 60, 80]) {
        await cdp().send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y: y - step }],
        });
      }
      await cdp().send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      // A tap on the first line after it, as #563's I3 has it: input is handled
      // in order, so the cursor moving there means the drag has landed.
      await tap(at.contentDOM.querySelector(".cm-line") as Element);
      await expect
        .poll(() => at.state.selection.main.head, {
          message: "the cursor after a tap on the first line",
        })
        .toSatisfy((head: number) => head >= 1 && head <= "A table".length);
      expect.soft(follow, "no note followed").not.toHaveBeenCalled();
      expect(open, "no tab opened").not.toHaveBeenCalled();
    },
  );

  // Guard: with the cursor in the table its source shows, and a tap on the
  // wikilink the cursor is in moves the cursor, as on a plain line.
  it.each(VIMS)(
    "I6 guard a tap on a wikilink in a table showing its source with vim %s moves the cursor and opens nothing",
    async (vim) => {
      const { doc } = linkedIn("[[Some note]]");
      const follow = vi.fn();
      const { at, block } = await appWith(doc, "tap", vim, "tbody .cm-wikilink", {
        onFollow: follow,
      });
      at.dispatch({ selection: { anchor: doc.indexOf("Some note") + 6 } });
      await expect
        .poll(() => block.isConnected, { message: "the table showing its source" })
        .toBe(false);
      const open = stubOpen();

      const word = doc.indexOf("Some note") + 2;
      const coords = at.coordsAtPos(word) as { left: number; top: number; bottom: number };
      await tapAt(framed([coords.left + 2, (coords.top + coords.bottom) / 2]));
      await expect
        .poll(() => at.state.selection.main.head, { message: "the cursor after the tap" })
        .toSatisfy((head: number) => Math.abs(head - word) <= 1);
      await settled();
      expect.soft(follow, "no note followed").not.toHaveBeenCalled();
      expect(open, "no tab opened").not.toHaveBeenCalled();
    },
  );

  // Guard: an embedded picture is no link, so a cell holding one opens the table.
  it.each(BOTH)(
    "I7 guard a %s on an embedded picture in a cell with vim %s opens the table",
    async (how, vim) => {
      const { doc, from } = linkedIn("![[pic.png]]");
      const follow = vi.fn();
      const { at, block, element } = await appWith(doc, how, vim, "tbody img.cm-image", {
        onFollow: follow,
        images: ["pic.png"],
      });
      const image = element as HTMLImageElement;
      image.src = picture("#98c379");
      await expect.poll(() => image.complete && image.naturalWidth > 0).toBe(true);
      const open = stubOpen();

      await act(image, how);
      await openedOnly(at, from, block, follow, open);
    },
  );

  // Off a table the wikilink wins over the link around it, `followOnClick`
  // and the tap both reading it first, so a cell does the same.
  it.each(BOTH)(
    "R1 #567 a %s on a wikilink inside a link in a cell with vim %s opens the note",
    async (how, vim) => {
      const { doc } = linkedIn("[see [[x]]](https://a.com)");
      const follow = vi.fn();
      const { block, element } = await appWith(doc, how, vim, "tbody .cm-wikilink", {
        onFollow: follow,
      });
      const open = stubOpen();
      // Seen in the capture phase, before anything can stop it: a build that
      // follows nothing changes nothing else to wait on.
      let clicks = 0;
      const count = () => clicks++;
      document.addEventListener("click", count, true);
      onTestFinished(() => document.removeEventListener("click", count, true));

      await act(element, how);
      await expect.poll(() => clicks, { message: "the click handled" }).toBe(1);
      await settled();
      expect.soft(block.isConnected, "the table stays drawn").toBe(true);
      expect.soft(open, "no tab opened").not.toHaveBeenCalled();
      expect(follow).toHaveBeenCalledExactlyOnceWith("x");
    },
  );

  // The pane a link opens off is the focused one (#361), so a tap in an
  // editor without the focus gives it the focus before following.
  it.each(VIMS)(
    "R2 #567 a tap on a wikilink in a cell of an editor without focus with vim %s focuses it before following",
    async (vim) => {
      const { doc } = linkedIn("[[Some note]]");
      let focused: boolean | null = null;
      const follow = vi.fn(() => {
        focused = at.hasFocus;
      });
      const { at, block, element } = await appWith(doc, "tap", vim, "tbody .cm-wikilink", {
        onFollow: follow,
      });
      const other = document.body.appendChild(document.createElement("input"));
      onTestFinished(() => other.remove());
      other.focus();
      expect(at.hasFocus).toBe(false);
      const open = stubOpen();

      await act(element, "tap");
      await followedNote(at, block, follow, open, "Some note");
      expect(focused, "the editor focused when it follows").toBe(true);
    },
  );
});
