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
  act,
  appWith,
  bothLanded,
  CAT,
  clicks,
  leftOf,
  linkOn,
  on,
  PRESSES,
  picture,
  pressAt,
  settled,
  stubOpen,
  tapAt,
  tapCleanup,
  textAt,
  VIMS,
} from "./wikilink-tap-fixture";

let app: App | undefined;

tapCleanup({
  get: () => app,
  set: (next) => {
    app = next;
  },
});

describe("a tap or a press on a wikilink follows it once", () => {
  // Guard: two taps far apart are two first clicks, each following.
  it.each(VIMS)(
    "I5 #569 guard a tap on one wikilink then on another far from it with vim %s follows each once",
    async (vim) => {
      // A line first: the cursor at the start of the note is in a link there.
      const doc = ["A line", "[[One]]", "", "", "", "", "", "", "", "[[Two]]"].join("\n");
      const { at, follow } = await appWith(doc, "tap", vim, ".cm-wikilink");
      const details = clicks(at);

      await act(linkOn(at, 1), "tap");
      await expect.poll(() => details.length, { message: "the first click handled" }).toBe(1);
      await settled();
      await act(linkOn(at, 9), "tap");
      await expect.poll(() => details.length, { message: "the clicks handled" }).toBe(2);
      await settled();
      expect(details, "two first clicks").toEqual([1, 1]);
      expect(follow.mock.calls).toEqual([["One"], ["Two"]]);
    },
  );

  // Chrome counts a tap close to the one before as its second, whatever the
  // first landed on, so a second click is only a repeat when the first followed.
  it.each(VIMS)(
    "R1 #569 a tap on a wikilink right after a tap on the text beside it with vim %s follows it",
    async (vim) => {
      const { at, follow } = await appWith("word [[Some note]]", "tap", vim, ".cm-wikilink");
      const details = clicks(at);
      // The end of the word and the start of the link: within the 20 pixels
      // Chrome counts a tap after another as its second.
      const word = textAt(at, "word".length, -2);
      const link = leftOf(linkOn(at, 0));

      await tapAt(word);
      await tapAt(link);
      await bothLanded(details);
      expect(follow).toHaveBeenCalledExactlyOnceWith("Some note");
    },
  );

  it.each(PRESSES)(
    "R1 #569 a %s press on a wikilink right after a plain click beside it with vim %s follows it",
    async (how, vim) => {
      const { at, follow } = await appWith("word [[Some note]]", how, vim, ".cm-wikilink");
      const details = clicks(at);
      const word = textAt(at, "word".length, -2);
      const link = leftOf(linkOn(at, 0));

      await pressAt(word, 0);
      await pressAt(link, how === "ctrl" ? 2 : 4, 2);
      await bothLanded(details);
      expect(follow).toHaveBeenCalledExactlyOnceWith("Some note");
    },
  );

  // A press on a picture never reaches the editor's own handlers, the widget
  // swallowing it. The picture is a linked one, which moves no cursor, above a
  // table, where a ctrl press moves none either, so nothing redraws between
  // the presses. Its address opens only on a first click, so here it opens
  // none. Presses with their count given, not taps: Chrome counts a tap as
  // the next only within 20 pixels, and the table sits further from the
  // picture than that.
  it.each(VIMS)(
    "R5 #569 a ctrl press on a wikilink after a press on a picture beside it, within the double-click window, with vim %s follows",
    async (vim) => {
      // A line first, for the cursor: on the picture's line it shows the source.
      const doc = [
        "A line",
        `[![a](${CAT})](https://x.com)`,
        "| [[A]] | b |",
        "| --- | --- |",
        "| c | d |",
      ].join("\n");
      const { at, follow } = await appWith(doc, "ctrl", vim, ".cm-table-block .cm-wikilink");
      await expect.poll(() => at.contentDOM.querySelector("img.cm-image")).not.toBeNull();
      const image = at.contentDOM.querySelector("img.cm-image") as HTMLImageElement;
      image.src = picture();
      await expect.poll(() => image.complete && image.naturalWidth > 0).toBe(true);
      const open = stubOpen();
      const details = clicks(at);
      const onLink = on(at.dom.querySelector(".cm-table-block thead .cm-wikilink") as Element);
      const onPicture = on(image);

      await pressAt(onLink, 2, 1);
      await pressAt(onPicture, 0, 2);
      await pressAt(onLink, 2, 3);
      await expect.poll(() => details.length, { message: "the clicks handled" }).toBe(3);
      await settled();
      expect(details, "the clicks' details").toEqual([1, 2, 3]);
      expect.soft(open, "no tab opened").not.toHaveBeenCalled();
      expect(follow.mock.calls).toEqual([["A"], ["A"]]);
    },
  );
});
