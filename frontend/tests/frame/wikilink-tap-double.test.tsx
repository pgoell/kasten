/**
 * A tap or a ctrl+click on a wikilink follows it once, and only a tap in the
 * link the cursor is in edits it (#568, #569).
 *
 * The cursor in a link is a position, not a name: another link to the same
 * note is not the one being edited. And a double tap or a double ctrl+click is
 * one follow, the second click carrying `detail` 2. This runs where the
 * table-link-*.test.tsx files do: a real browser, a real finger from the
 * DevTools protocol, and the app's own editor, whose `onFollow` is a spy.
 */

import {
  type App,
  appWith,
  bothLanded,
  CELL,
  cellLink,
  clicks,
  linkOn,
  on,
  PRESSES,
  pressAt,
  settled,
  stubOpen,
  tapAt,
  tapCleanup,
  twice,
  VIMS,
  WHERE,
} from "./wikilink-tap-fixture";

let app: App | undefined;

tapCleanup({
  get: () => app,
  set: (next) => {
    app = next;
  },
});

describe("a tap or a press on a wikilink follows it once", () => {
  it.each(VIMS)("A4 #569 a double tap on a wikilink with vim %s opens it once", async (vim) => {
    const { at, follow } = await appWith("A line\n[[Some note]] two", "tap", vim, ".cm-wikilink");
    const details = clicks(at);

    await twice(linkOn(at, 1), "tap");
    await bothLanded(details);
    expect(follow).toHaveBeenCalledExactlyOnceWith("Some note");
  });

  it.each(VIMS)(
    "A5 #569 a double tap on a wikilink in a cell with vim %s opens it once",
    async (vim) => {
      const { at, follow } = await appWith(CELL, "tap", vim, ".cm-table-block .cm-wikilink");
      const details = clicks(at);

      await twice(cellLink(at), "tap");
      await bothLanded(details);
      expect(follow).toHaveBeenCalledExactlyOnceWith("Some note");
    },
  );

  it.each(WHERE)(
    "A6 #569 a double %s press on a wikilink in a %s with vim %s opens it once",
    async (how, where, vim) => {
      const doc = where === "line" ? "A line\n[[Some note]] two" : CELL;
      const selector = where === "line" ? ".cm-wikilink" : ".cm-table-block .cm-wikilink";
      const { at, follow } = await appWith(doc, how, vim, selector);
      const details = clicks(at);

      await twice(where === "line" ? linkOn(at, 1) : cellLink(at), how);
      await bothLanded(details);
      expect(follow).toHaveBeenCalledExactlyOnceWith("Some note");
    },
  );

  it.each(VIMS)(
    "I4 #569 a double tap on a markdown link with vim %s opens one tab",
    async (vim) => {
      const { at } = await appWith("A line\n[t](https://a.com) two", "tap", vim, ".cm-link");
      const open = stubOpen();
      const details = clicks(at);

      // The text's own span, nested in the link's.
      await twice(at.contentDOM.querySelector(".cm-link span") as Element, "tap");
      await bothLanded(details);
      expect(open).toHaveBeenCalledExactlyOnceWith("https://a.com", "_blank", "noopener");
    },
  );

  it.each(PRESSES)(
    "R3 #569 a double %s press on a markdown link with vim %s opens one tab",
    async (how, vim) => {
      const { at } = await appWith("A line\n[t](https://a.com) two", how, vim, ".cm-link");
      const open = stubOpen();
      const details = clicks(at);

      // The text's own span, nested in the link's.
      await twice(at.contentDOM.querySelector(".cm-link span") as Element, how);
      await bothLanded(details);
      expect(open).toHaveBeenCalledExactlyOnceWith("https://a.com", "_blank", "noopener");
    },
  );

  it.each(PRESSES)(
    "R4 #569 a triple %s press on a markdown link with vim %s opens one tab",
    async (how, vim) => {
      const { at } = await appWith("A line\n[t](https://a.com) two", how, vim, ".cm-link");
      const open = stubOpen();
      const details = clicks(at);

      const point = on(at.contentDOM.querySelector(".cm-link span") as Element);
      for (const count of [1, 2, 3]) await pressAt(point, how === "ctrl" ? 2 : 4, count);
      await expect.poll(() => details.length, { message: "the clicks handled" }).toBe(3);
      await settled();
      expect(details, "the clicks' details").toEqual([1, 2, 3]);
      expect(open).toHaveBeenCalledExactlyOnceWith("https://a.com", "_blank", "noopener");
    },
  );

  it.each(VIMS)(
    "R4 #569 a triple tap on a wikilink in a cell with vim %s follows once",
    async (vim) => {
      const { at, follow } = await appWith(CELL, "tap", vim, ".cm-table-block .cm-wikilink");
      const details = clicks(at);

      const point = on(cellLink(at));
      for (let tap = 0; tap < 3; tap++) await tapAt(point);
      await expect.poll(() => details.length, { message: "the clicks handled" }).toBe(3);
      await settled();
      expect(details, "the clicks' details").toEqual([1, 2, 3]);
      expect(follow).toHaveBeenCalledExactlyOnceWith("Some note");
    },
  );
});
