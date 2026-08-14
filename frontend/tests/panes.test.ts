import {
  activeTab,
  addTab,
  clearFocused,
  emptyLayout,
  focusedPane,
  focusPane,
  goToTab,
  isSplit,
  type Layout,
  mapPanes,
  nextPane,
  openBookBeside,
  openImageInFocused,
  openInFocused,
  openReviewInFocused,
  openTerminalInFocused,
  openTodosInFocused,
  openVideoBeside,
  panesOf,
  removeFocused,
  splitFocused,
  stepTab,
  tabPanes,
} from "@/lib/panes";

/**
 * Read an index the compiler will not trust.
 *
 * `noUncheckedIndexedAccess` is on, and a missing pane in one of these is the
 * failure the test is looking for anyway, so it says which index was empty
 * rather than reporting `undefined` two lines later.
 */
function at<T>(items: T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`nothing at ${index} of ${items.length}`);
  return item;
}

/** The focused pane's note, or null while it holds none. Most tests read this. */
function open(layout: Layout): string | null {
  return focusedPane(layout).path ?? null;
}

/** Every note on screen in the active tab, in the order the panes sit in. */
function notes(layout: Layout): (string | null)[] {
  return tabPanes(layout).map((pane) => pane.path ?? null);
}

describe("a fresh layout", () => {
  it("is one tab holding one empty pane", () => {
    const layout = emptyLayout();

    expect(layout.tabs).toHaveLength(1);
    expect(tabPanes(layout)).toHaveLength(1);
    expect(open(layout)).toBeNull();
  });

  it("can start on a note, which is what a reload hands it", () => {
    const layout = emptyLayout("ideas/borges.md", 12);

    expect(open(layout)).toBe("ideas/borges.md");
    expect(focusedPane(layout).line).toBe(12);
  });
});

describe("splitting", () => {
  it("puts an empty pane beside this one and moves to it", () => {
    const layout = splitFocused(emptyLayout("a.md"), "row");

    expect(notes(layout)).toEqual(["a.md", null]);
    expect(open(layout)).toBeNull();
  });

  it("leaves the other panes alone", () => {
    const layout = openInFocused(splitFocused(emptyLayout("a.md"), "row"), "b.md");

    expect(notes(layout)).toEqual(["a.md", "b.md"]);
  });

  it("splits the focused pane and not the first one", () => {
    // a | b, focus on b, then split b downward: a | (b over empty).
    const two = openInFocused(splitFocused(emptyLayout("a.md"), "row"), "b.md");
    const layout = splitFocused(two, "col");

    expect(notes(layout)).toEqual(["a.md", "b.md", null]);

    const root = at(layout.tabs, 0).root;
    if (!isSplit(root)) throw new Error("the root should be a split");
    expect(root.dir).toBe("row");
    expect(root.children).toHaveLength(2);
    // The second child is the nested column, because only b was divided.
    const nested = at(root.children, 1);
    if (!isSplit(nested)) throw new Error("b should have become a column");
    expect(nested.dir).toBe("col");
  });

  // React keys the rendered tree off these ids. A split handed a new one on
  // every change would re-key the pane beside the one being divided, throwing
  // away a CodeMirror view, a cursor and an undo history nobody touched.
  it("keeps a split's id while a pane inside it is divided", () => {
    const two = splitFocused(emptyLayout("a.md"), "row");
    const before = at(two.tabs, 0).root;
    if (!isSplit(before)) throw new Error("the root should be a split");

    const after = at(splitFocused(two, "col").tabs, 0).root;
    if (!isSplit(after)) throw new Error("the root should still be a split");

    expect(after.id).toBe(before.id);
  });

  it("keeps three panes side by side flat rather than nesting them", () => {
    // Splitting the same way twice should give even thirds, not a half and
    // two quarters, so the second split joins the row instead of nesting in it.
    const layout = splitFocused(splitFocused(emptyLayout("a.md"), "row"), "row");

    const root = at(layout.tabs, 0).root;
    if (!isSplit(root)) throw new Error("the root should be a split");
    expect(root.children).toHaveLength(3);
    expect(root.children.every((child) => !isSplit(child))).toBe(true);
  });
});

describe("moving between panes", () => {
  it("walks them in order and wraps at the end", () => {
    const three = splitFocused(splitFocused(emptyLayout("a.md"), "row"), "row");
    const order = tabPanes(three);

    // The focus starts on the third, which is the one the last split made, so
    // the first step is the wrap.
    const back = nextPane(three);
    expect(focusedPane(back).id).toBe(at(order, 0).id);
    expect(focusedPane(nextPane(back)).id).toBe(at(order, 1).id);
    expect(focusedPane(nextPane(nextPane(back))).id).toBe(at(order, 2).id);
  });

  it("goes straight to the pane a click names", () => {
    const two = splitFocused(emptyLayout("a.md"), "row");
    const first = at(tabPanes(two), 0);

    expect(focusedPane(focusPane(two, first.id)).id).toBe(first.id);
  });
});

describe("closing", () => {
  it("empties a pane holding a note, leaving the pane behind", () => {
    const layout = clearFocused(emptyLayout("a.md"));

    expect(tabPanes(layout)).toHaveLength(1);
    expect(open(layout)).toBeNull();
  });

  it("drops a stale line with the note", () => {
    expect(focusedPane(clearFocused(emptyLayout("a.md", 40))).line).toBeUndefined();
  });

  it("removes an empty pane, leaving its neighbour", () => {
    const layout = removeFocused(splitFocused(emptyLayout("a.md"), "row"));

    expect(notes(layout)).toEqual(["a.md"]);
  });

  it("collapses the split it emptied rather than leaving a split of one", () => {
    const layout = removeFocused(splitFocused(emptyLayout("a.md"), "row"));

    expect(isSplit(at(layout.tabs, 0).root)).toBe(false);
  });

  it("focuses the pane that took its place", () => {
    // a | b | c with the focus on b. Closing b should land on c, which is now
    // second, rather than jumping back to the start.
    const three = splitFocused(splitFocused(emptyLayout("a.md"), "row"), "row");
    const labelled = openInFocused(focusPane(three, at(tabPanes(three), 1).id), "b.md");
    const withC = openInFocused(focusPane(labelled, at(tabPanes(labelled), 2).id), "c.md");
    const onB = focusPane(withC, at(tabPanes(withC), 1).id);

    const layout = removeFocused(onB);

    expect(notes(layout)).toEqual(["a.md", "c.md"]);
    expect(open(layout)).toBe("c.md");
  });

  it("takes the tab away with the last pane in it", () => {
    const layout = removeFocused(addTab(emptyLayout("a.md")));

    expect(layout.tabs).toHaveLength(1);
    expect(open(layout)).toBe("a.md");
  });

  it("stands still on the last pane of the last tab, having nothing to close", () => {
    const alone = emptyLayout();

    expect(removeFocused(alone)).toBe(alone);
  });
});

describe("tabs", () => {
  it("starts a new one on an empty pane and goes to it", () => {
    const layout = addTab(emptyLayout("a.md"));

    expect(layout.tabs).toHaveLength(2);
    expect(layout.active).toBe(1);
    expect(open(layout)).toBeNull();
  });

  it("wraps walking forward and back", () => {
    const two = addTab(emptyLayout());

    expect(stepTab(two, 1).active).toBe(0);
    expect(stepTab(stepTab(two, 1), -1).active).toBe(1);
  });

  it("jumps to one by position", () => {
    const three = addTab(addTab(emptyLayout()));

    expect(goToTab(three, 0).active).toBe(0);
    expect(goToTab(three, 2).active).toBe(2);
  });

  it("ignores a digit naming a tab that is not open", () => {
    const two = addTab(emptyLayout());

    expect(goToTab(two, 9)).toBe(two);
  });

  it("keeps each tab's own panes and focus apart", () => {
    const first = splitFocused(emptyLayout("a.md"), "row");
    const second = addTab(first);

    expect(tabPanes(second)).toHaveLength(1);
    expect(tabPanes(goToTab(second, 0))).toHaveLength(2);
  });
});

describe("following a note that moved", () => {
  it("rewrites the path in every pane holding it, across tabs", () => {
    const split = openInFocused(splitFocused(emptyLayout("a.md"), "row"), "a.md");
    const both = addTab(split);
    const opened = openInFocused(both, "a.md");

    const layout = mapPanes(opened, (pane) =>
      pane.path === "a.md" ? { ...pane, path: "moved/a.md" } : pane,
    );

    expect(notes(layout)).toEqual(["moved/a.md"]);
    expect(notes(goToTab(layout, 0))).toEqual(["moved/a.md", "moved/a.md"]);
  });

  it("leaves the panes holding other notes alone", () => {
    const two = openInFocused(splitFocused(emptyLayout("a.md"), "row"), "b.md");

    const layout = mapPanes(two, (pane) =>
      pane.path === "b.md" ? { ...pane, path: "moved/b.md" } : pane,
    );

    expect(notes(layout)).toEqual(["a.md", "moved/b.md"]);
  });
});

describe("a terminal in a pane", () => {
  it("puts the session on the focused pane and keeps its id", () => {
    const layout = emptyLayout();
    const before = focusedPane(layout).id;

    const opened = openTerminalInFocused(layout, "kasten");

    expect(focusedPane(opened).term).toBe("kasten");
    // The tab names its focused pane by id, so a new one would lose track of it.
    expect(focusedPane(opened).id).toBe(before);
  });

  it("takes the note out of the pane it replaces", () => {
    // The pane is written whole the way `openInFocused` writes it, so a line
    // left over from a search hit cannot survive into a terminal either.
    const layout = openTerminalInFocused(emptyLayout("a.md", 12), "kasten");

    expect(focusedPane(layout).path).toBeUndefined();
    expect(focusedPane(layout).line).toBeUndefined();
  });

  it("is taken out of the pane by a clear, leaving the pane on screen", () => {
    // What `<leader>q` and the terminal's own close chord reach. A terminal
    // pane holds no note, so the route used to send it straight to the removal
    // instead, which does nothing at all on the last pane of the last tab: a
    // window holding one terminal had no way back to an editor.
    const layout = clearFocused(openTerminalInFocused(emptyLayout(), "kasten"));

    expect(focusedPane(layout).term).toBeUndefined();
    expect(focusedPane(layout).path).toBeUndefined();
    expect(tabPanes(layout)).toHaveLength(1);
  });

  it("is skipped by a note that moved, with no code of its own", () => {
    // `mapPanes` follows a move by keying on `path`, and a terminal pane has
    // none. That is the whole reason `term` sits beside `path` rather than
    // replacing it with a union.
    const split = openTerminalInFocused(splitFocused(emptyLayout("a.md"), "row"), "kasten");

    const layout = mapPanes(split, (pane) =>
      pane.path === "a.md" ? { ...pane, path: "moved/a.md" } : pane,
    );

    expect(tabPanes(layout).map((pane) => pane.term ?? null)).toEqual([null, "kasten"]);
    expect(notes(layout)).toEqual(["moved/a.md", null]);
  });
});

describe("the todo list in a pane", () => {
  it("takes the note out of the pane it replaces, keeping its id", () => {
    const before = emptyLayout("a.md", 12);
    const layout = openTodosInFocused(before);

    expect(focusedPane(layout).todos).toBe(true);
    expect(focusedPane(layout).path).toBeUndefined();
    expect(focusedPane(layout).line).toBeUndefined();
    // The tab names its focused pane by id, so a new one would lose track of it.
    expect(focusedPane(layout).id).toBe(focusedPane(before).id);
  });

  it("is taken out of the pane by a clear, leaving the pane on screen", () => {
    // What `<leader>q` reaches. Emptying rather than removing, so a window
    // holding only the todo list has a way back to an editor.
    const layout = clearFocused(openTodosInFocused(emptyLayout()));

    expect(focusedPane(layout).todos).toBeUndefined();
    expect(tabPanes(layout)).toHaveLength(1);
  });
});

describe("an image in a pane", () => {
  it("takes the note out of the pane it replaces, keeping its id", () => {
    const before = emptyLayout("a.md", 12);
    const layout = openImageInFocused(before, "99 Misc/shot.png");

    expect(focusedPane(layout).image).toBe("99 Misc/shot.png");
    expect(focusedPane(layout).path).toBeUndefined();
    expect(focusedPane(layout).line).toBeUndefined();
    expect(focusedPane(layout).id).toBe(focusedPane(before).id);
  });

  it("is taken out of the pane by a clear, leaving the pane on screen", () => {
    // What `<leader>q` reaches, the way it reaches the todo list above: a window
    // holding one image has to have a way back to an editor.
    const layout = clearFocused(openImageInFocused(emptyLayout(), "99 Misc/shot.png"));

    expect(focusedPane(layout).image).toBeUndefined();
    expect(tabPanes(layout)).toHaveLength(1);
  });
});

describe("panesOf", () => {
  it("reads a bare pane as one pane", () => {
    expect(panesOf(at(emptyLayout().tabs, 0).root)).toHaveLength(1);
  });
});

describe("a book in a pane beside its note", () => {
  it("splits the focused pane and puts the book in the new one", () => {
    const layout = openBookBeside(emptyLayout("lit/DDIA.md"), "lit/DDIA.md");

    // The note stays where it was. A key called "read this book beside this
    // note" must not eat the note.
    expect(tabPanes(layout).map((pane) => pane.path ?? null)).toEqual(["lit/DDIA.md", null]);
    expect(tabPanes(layout).map((pane) => pane.book ?? null)).toEqual([null, "lit/DDIA.md"]);
  });

  it("leaves the focus on the reader", () => {
    const layout = openBookBeside(emptyLayout("lit/DDIA.md"), "lit/DDIA.md");

    expect(focusedPane(layout).book).toBe("lit/DDIA.md");
  });

  it("goes to the pane already reading that book rather than making a second", () => {
    const once = openBookBeside(emptyLayout("lit/DDIA.md"), "lit/DDIA.md");
    const reader = focusedPane(once).id;

    const twice = openBookBeside(nextPane(once), "lit/DDIA.md");

    expect(tabPanes(twice)).toHaveLength(2);
    expect(focusedPane(twice).id).toBe(reader);
  });
});

describe("a video in a pane beside its note", () => {
  it("stacks the player under the note rather than beside it", () => {
    const layout = openVideoBeside(emptyLayout("lit/talk.md"), "lit/talk.md");
    const root = activeTab(layout).root;

    // A 16:9 player wants the width the note also wants, so the two share the
    // height instead. The reader parts company here and takes a `row`.
    expect(isSplit(root) && root.dir).toBe("col");
  });

  it("splits the focused pane and puts the player in the new one", () => {
    const layout = openVideoBeside(emptyLayout("lit/talk.md"), "lit/talk.md");

    // The note stays where it was, which is the whole point: the pane is for
    // watching while writing in the note the key was pressed in.
    expect(tabPanes(layout).map((pane) => pane.path ?? null)).toEqual(["lit/talk.md", null]);
    expect(tabPanes(layout).map((pane) => pane.video ?? null)).toEqual([null, "lit/talk.md"]);
  });

  it("leaves the focus on the player", () => {
    const layout = openVideoBeside(emptyLayout("lit/talk.md"), "lit/talk.md");

    expect(focusedPane(layout).video).toBe("lit/talk.md");
  });

  it("goes to the pane already playing that note rather than making a second", () => {
    const once = openVideoBeside(emptyLayout("lit/talk.md"), "lit/talk.md");
    const player = focusedPane(once).id;

    const twice = openVideoBeside(nextPane(once), "lit/talk.md");

    expect(tabPanes(twice)).toHaveLength(2);
    expect(focusedPane(twice).id).toBe(player);
  });
});

describe("openReviewInFocused", () => {
  it("puts the review in the focused pane and clears what it held", () => {
    const layout = openReviewInFocused(openInFocused(emptyLayout("a"), "notes/borges.md"));

    const pane = focusedPane(layout);
    expect(pane?.review).toBe(true);
    expect(pane?.path).toBeUndefined();
  });

  it("leaves every other pane alone", () => {
    const split = splitFocused(emptyLayout("a"), "row");

    const layout = openReviewInFocused(split);

    expect(tabPanes(layout).filter((pane) => pane.review === true)).toHaveLength(1);
    expect(tabPanes(layout)).toHaveLength(2);
  });
});
