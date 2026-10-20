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

import { userEvent } from "vitest/browser";
import {
  type App,
  act,
  appWith,
  cellLink,
  framed,
  landed,
  linkOn,
  settled,
  TABLED,
  TWO,
  tapAt,
  tapCleanup,
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
  it.each(VIMS)(
    "A1 #568 a tap on a wikilink with vim %s opens it while the cursor rests in another to the same note",
    async (vim) => {
      const { at, follow } = await appWith(TWO, "tap", vim, ".cm-wikilink");
      at.dispatch({ selection: { anchor: 4 } });

      await act(linkOn(at, 1), "tap");
      await landed(at, follow, 4);
      expect(follow).toHaveBeenCalledExactlyOnceWith("Some note");
    },
  );

  it.each(WHERE)(
    "A3 #568 a %s press on a wikilink in a %s with vim %s opens it while the cursor rests in another to the same note",
    async (how, where, vim) => {
      const doc = where === "line" ? TWO : TABLED;
      const selector = where === "line" ? ".cm-wikilink" : ".cm-table-block .cm-wikilink";
      const { at, follow } = await appWith(doc, how, vim, selector);
      at.dispatch({ selection: { anchor: 4 } });

      await act(where === "line" ? linkOn(at, 1) : cellLink(at), how);
      await landed(at, follow, 4);
      expect(follow).toHaveBeenCalledExactlyOnceWith("Some note");
    },
  );

  // Guard: the link the cursor is in is the one being edited.
  it.each(VIMS)(
    "I1 #568 guard a tap in the wikilink the cursor is in with vim %s moves the cursor and opens nothing",
    async (vim) => {
      const { at, follow } = await appWith(TWO, "tap", vim, ".cm-wikilink");
      at.dispatch({ selection: { anchor: 4 } });
      await settled();

      const word = 8;
      const coords = at.coordsAtPos(word) as { left: number; top: number; bottom: number };
      await tapAt(framed([coords.left + 2, (coords.top + coords.bottom) / 2]));
      await expect
        .poll(() => at.state.selection.main.head, { message: "the cursor after the tap" })
        .toSatisfy((head: number) => Math.abs(head - word) <= 1);
      await settled();
      expect(follow).not.toHaveBeenCalled();
    },
  );

  it.each(VIMS)(
    "I2 #568 a tap on the second of two wikilinks to one note on a line with vim %s opens it while the cursor rests in the first",
    async (vim) => {
      const { at, follow } = await appWith(
        "[[Some note]] and [[Some note]]",
        "tap",
        vim,
        ".cm-wikilink",
      );
      at.dispatch({ selection: { anchor: 4 } });

      await act(linkOn(at, 0, 1), "tap");
      await landed(at, follow, 4);
      expect(follow).toHaveBeenCalledExactlyOnceWith("Some note");
    },
  );

  // Where `$` lands on a line ending in a link: past its hidden `]]`, which
  // still counts as in it. vim may step back one, still in it.
  it.each(VIMS)(
    "I3 #568 a tap on a wikilink with vim %s opens it while the cursor rests at the end of another to the same note",
    async (vim) => {
      const doc = "[[Some note]]\n[[Some note]] two";
      const { at, follow } = await appWith(doc, "tap", vim, ".cm-wikilink");
      at.dispatch({ selection: { anchor: "[[Some note]]".length } });
      const head = at.state.selection.main.head;

      await act(linkOn(at, 1), "tap");
      await landed(at, follow, head);
      expect(follow).toHaveBeenCalledExactlyOnceWith("Some note");
    },
  );

  it.each(VIMS)(
    "R2 a tap on a wikilink with vim %s follows it while the cursor rests between it and the next link",
    async (vim) => {
      const { at, follow } = await appWith("[[a]][[b]]", "tap", vim, ".cm-wikilink");
      // From inside the second link, which shows its `[[`, as a step left
      // from there goes: from anywhere else the cursor is walked off the
      // hidden `[[` into the link. vim's normal mode shows no marks, so the
      // cursor rests here only in insert mode.
      if (vim === "on") {
        at.focus();
        await userEvent.keyboard("i");
      }
      at.dispatch({ selection: { anchor: 7 } });
      at.dispatch({ selection: { anchor: 5 } });
      await settled();
      expect(at.state.selection.main.head, "the cursor between the links").toBe(5);

      await act(linkOn(at, 0), "tap");
      await landed(at, follow, 5);
      expect(follow).toHaveBeenCalledExactlyOnceWith("a");
    },
  );

  it.each(VIMS)(
    "R6 #568 a tap on the first of two adjacent wikilinks to one note with vim %s follows while the cursor rests between them",
    async (vim) => {
      const { at, follow } = await appWith("[[a]][[a]]", "tap", vim, ".cm-wikilink");
      // As in R2: from inside the second link, in insert mode for vim.
      if (vim === "on") {
        at.focus();
        await userEvent.keyboard("i");
      }
      at.dispatch({ selection: { anchor: 7 } });
      at.dispatch({ selection: { anchor: 5 } });
      await settled();
      expect(at.state.selection.main.head, "the cursor between the links").toBe(5);

      await act(linkOn(at, 0), "tap");
      await landed(at, follow, 5);
      expect(follow).toHaveBeenCalledExactlyOnceWith("a");
    },
  );
});
