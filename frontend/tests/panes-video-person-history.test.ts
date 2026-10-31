import { openBeside } from "@/lib/pane-contents";
import { activeTab, emptyLayout, focusedPane, isSplit, nextPane, tabPanes } from "@/lib/panes";

describe("a video in a pane beside its note", () => {
  it("stacks the player under the note rather than beside it", () => {
    const layout = openBeside(
      emptyLayout("lit/talk.md"),
      (pane) => pane.video === "lit/talk.md",
      { video: "lit/talk.md" },
      "col",
    );
    const root = activeTab(layout).root;

    // A 16:9 player wants the width the note also wants, so the two share the
    // height instead. The reader parts company here and takes a `row`.
    expect(isSplit(root) && root.dir).toBe("col");
  });

  it("splits the focused pane and puts the player in the new one", () => {
    const layout = openBeside(
      emptyLayout("lit/talk.md"),
      (pane) => pane.video === "lit/talk.md",
      { video: "lit/talk.md" },
      "col",
    );

    // The note stays where it was, which is the whole point: the pane is for
    // watching while writing in the note the key was pressed in.
    expect(tabPanes(layout).map((pane) => pane.path ?? null)).toEqual(["lit/talk.md", null]);
    expect(tabPanes(layout).map((pane) => pane.video ?? null)).toEqual([null, "lit/talk.md"]);
  });

  it("leaves the focus on the player", () => {
    const layout = openBeside(
      emptyLayout("lit/talk.md"),
      (pane) => pane.video === "lit/talk.md",
      { video: "lit/talk.md" },
      "col",
    );

    expect(focusedPane(layout).video).toBe("lit/talk.md");
  });

  it("goes to the pane already playing that note rather than making a second", () => {
    const once = openBeside(
      emptyLayout("lit/talk.md"),
      (pane) => pane.video === "lit/talk.md",
      { video: "lit/talk.md" },
      "col",
    );
    const player = focusedPane(once).id;

    const twice = openBeside(
      nextPane(once),
      (pane) => pane.video === "lit/talk.md",
      { video: "lit/talk.md" },
      "col",
    );

    expect(tabPanes(twice)).toHaveLength(2);
    expect(focusedPane(twice).id).toBe(player);
  });
});

describe("a person's card in a pane beside their note", () => {
  const MAX = "03 Areas/08 People/Max Bosch.md";

  it("splits the focused pane and puts the card in the new one", () => {
    const layout = openBeside(
      emptyLayout(MAX),
      (pane) => pane.person === MAX,
      { person: MAX },
      "row",
    );

    // The note stays where it was: the card is read against whatever is open,
    // and a key that ate that note would leave nothing to read it against.
    expect(tabPanes(layout).map((pane) => pane.path ?? null)).toEqual([MAX, null]);
    expect(tabPanes(layout).map((pane) => pane.person ?? null)).toEqual([null, MAX]);
    expect(focusedPane(layout).person).toBe(MAX);
  });

  it("sets the card beside the note rather than under it", () => {
    const root = activeTab(
      openBeside(emptyLayout(MAX), (pane) => pane.person === MAX, { person: MAX }, "row"),
    ).root;

    expect(isSplit(root) && root.dir).toBe("row");
  });

  it("goes to the pane already showing that person rather than making a second", () => {
    const once = openBeside(
      emptyLayout(MAX),
      (pane) => pane.person === MAX,
      { person: MAX },
      "row",
    );
    const card = focusedPane(once).id;

    const twice = openBeside(nextPane(once), (pane) => pane.person === MAX, { person: MAX }, "row");

    expect(tabPanes(twice)).toHaveLength(2);
    expect(focusedPane(twice).id).toBe(card);
  });
});

describe("a note's history in a pane beside it", () => {
  const NOTE = "notes/plan.md";

  it("#425 A1 splits the focused pane and puts the history beside the note, focused", () => {
    const layout = openBeside(
      emptyLayout(NOTE),
      (pane) => pane.history === NOTE,
      { history: NOTE },
      "row",
    );

    expect(tabPanes(layout).map((pane) => pane.path ?? null)).toEqual([NOTE, null]);
    expect(tabPanes(layout).map((pane) => pane.history ?? null)).toEqual([null, NOTE]);
    expect(focusedPane(layout).history).toBe(NOTE);
    const root = activeTab(layout).root;
    expect(isSplit(root) && root.dir).toBe("row");
  });

  it("#425 A1 goes to the pane already showing that note's history rather than making a second", () => {
    const once = openBeside(
      emptyLayout(NOTE),
      (pane) => pane.history === NOTE,
      { history: NOTE },
      "row",
    );
    const pane = focusedPane(once).id;

    const twice = openBeside(
      nextPane(once),
      (pane) => pane.history === NOTE,
      { history: NOTE },
      "row",
    );

    expect(tabPanes(twice)).toHaveLength(2);
    expect(focusedPane(twice).id).toBe(pane);
  });
});
