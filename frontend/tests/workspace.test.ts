import { openChatInFocused, openPdfBeside, openTerminalInFocused } from "@/lib/pane-contents";
import { addTab, emptyLayout, type Layout, panesOf, splitFocused, toggleZoom } from "@/lib/panes";
import { loadWorkspace, saveWorkspace } from "@/lib/workspace";

const FINE = "kasten.workspace.1";
const COARSE = "kasten.workspace.coarse.1";

// The storage put back first, or the cleanup itself meets a refusing one.
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem(FINE);
  localStorage.removeItem(COARSE);
});

/** Every id a layout holds, tabs and splits included. */
function idsOf(layout: Layout): string[] {
  const walk = (node: Layout["tabs"][number]["root"]): string[] =>
    "dir" in node ? [node.id, ...node.children.flatMap(walk)] : [node.id];
  return layout.tabs.flatMap((tab) => [tab.id, ...walk(tab.root)]);
}

/** The layout with every id taken out, focus named by position instead. */
function shapeOf(layout: Layout): unknown {
  const strip = (node: Layout["tabs"][number]["root"]): unknown =>
    "dir" in node
      ? { dir: node.dir, children: node.children.map(strip) }
      : { ...node, id: undefined };
  return {
    active: layout.active,
    tabs: layout.tabs.map((tab) => ({
      zoom: tab.zoom,
      focus: panesOf(tab.root).findIndex((pane) => pane.id === tab.focus),
      root: strip(tab.root),
    })),
  };
}

/** Two tabs: a note beside a column of a terminal and a chat, and a pdf. */
function sample(): Layout {
  let layout = emptyLayout("index.md");
  layout = splitFocused(layout, "row");
  layout = openTerminalInFocused(layout, "main");
  layout = splitFocused(layout, "col");
  layout = openChatInFocused(layout);
  layout = toggleZoom(layout);
  layout = addTab(layout);
  return openPdfBeside(layout, "plan.pdf", 3);
}

describe("workspace", () => {
  it("A1 A2 A4 a saved layout comes back with its splits, tabs, focus and zoom", () => {
    const layout = sample();
    saveWorkspace(false, layout, true);

    const back = loadWorkspace(false);

    expect(back?.treeOpen).toBe(true);
    expect(shapeOf(back?.layout as Layout)).toEqual(
      shapeOf({
        ...layout,
        // `opened` is a count of this page's opens, so a restore opens once.
        tabs: layout.tabs.map((tab, at) =>
          at === 1
            ? {
                ...tab,
                root: {
                  ...tab.root,
                  children:
                    "dir" in tab.root
                      ? tab.root.children.map((child) =>
                          "pdf" in child ? { ...child, pdf: { ...child.pdf, opened: 1 } } : child,
                        )
                      : [],
                },
              }
            : tab,
        ),
      }),
    );
  });

  it.each([
    ["note", { path: "a.md" }],
    ["todos", { todos: true }],
    ["review", { review: true }],
    ["vault graph", { graph: {} }],
    ["local graph", { graph: { around: "a.md" } }],
    ["history", { history: "a.md" }],
    ["chat", { chat: true }],
    ["terminal", { term: "main" }],
    ["book", { book: "a.md" }],
    ["exam", { exam: "a.md" }],
    ["image", { image: "a.png" }],
    ["pdf", { pdf: { path: "a.pdf", page: 2, opened: 1 } }],
    ["html", { html: "a.html" }],
    ["video", { video: "a.md" }],
    ["person", { person: "a.md" }],
    ["empty", {}],
  ])("A3 a pane holding a %s comes back holding it", (_kind, holds) => {
    const layout = emptyLayout();
    const [tab] = layout.tabs;
    if (!tab) throw new Error("no tab");
    saveWorkspace(
      false,
      { ...layout, tabs: [{ ...tab, root: { id: tab.focus, ...holds } }] },
      true,
    );

    const pane = loadWorkspace(false)?.layout.tabs[0]?.root;

    expect({ ...pane, id: undefined }).toEqual({ id: undefined, ...holds });
  });

  it("A3 the line, the jump and the pdf's open count are not saved", () => {
    const layout = openPdfBeside(emptyLayout("index.md", 40), "a.pdf", 5);
    const tab = layout.tabs[0];
    if (!tab || !("dir" in tab.root)) throw new Error("no split");
    const note = tab.root.children[0];
    if (!note) throw new Error("no note");
    tab.root.children[0] = { ...note, jump: 3 };
    saveWorkspace(false, layout, true);

    const raw = localStorage.getItem(FINE) ?? "";

    expect(raw).not.toContain('"line"');
    expect(raw).not.toContain('"jump"');
    expect(raw).not.toContain('"opened"');
  });

  it.each([
    ["not JSON", "{not json"],
    ["no layout", JSON.stringify({ treeOpen: true })],
    ["no tabs", JSON.stringify({ layout: { tabs: [], active: 0 }, treeOpen: true })],
    [
      "active out of range",
      JSON.stringify({
        layout: { tabs: [{ id: "t", root: { id: "p" }, focus: "p" }], active: 1 },
        treeOpen: true,
      }),
    ],
    [
      "focus on no pane",
      JSON.stringify({
        layout: { tabs: [{ id: "t", root: { id: "p" }, focus: "q" }], active: 0 },
        treeOpen: true,
      }),
    ],
    [
      "a split going no way",
      JSON.stringify({
        layout: {
          tabs: [{ id: "t", root: { id: "s", dir: "up", children: [{ id: "p" }] }, focus: "p" }],
          active: 0,
        },
        treeOpen: true,
      }),
    ],
    [
      "a split with no children",
      JSON.stringify({
        layout: { tabs: [{ id: "t", root: { id: "s", dir: "row", children: [] }, focus: "p" }] },
        treeOpen: true,
      }),
    ],
    [
      "a field of the wrong type",
      JSON.stringify({
        layout: { tabs: [{ id: "t", root: { id: "p", path: 3 }, focus: "p" }], active: 0 },
        treeOpen: true,
      }),
    ],
    [
      "a field nobody knows",
      JSON.stringify({
        layout: { tabs: [{ id: "t", root: { id: "p", canvas: "x" }, focus: "p" }], active: 0 },
        treeOpen: true,
      }),
    ],
    [
      "two panes on one id",
      JSON.stringify({
        layout: {
          tabs: [
            {
              id: "t",
              root: { id: "s", dir: "row", children: [{ id: "p" }, { id: "p" }] },
              focus: "p",
            },
          ],
          active: 0,
        },
        treeOpen: true,
      }),
    ],
    ["treeOpen not a flag", JSON.stringify({ layout: emptyLayout(), treeOpen: "yes" })],
    [
      "a pdf naming no file",
      JSON.stringify({
        layout: { tabs: [{ id: "t", root: { id: "p", pdf: { page: 2 } }, focus: "p" }], active: 0 },
        treeOpen: true,
      }),
    ],
  ])("I1 a saved workspace with %s starts clean and is removed", (_what, raw) => {
    localStorage.setItem(FINE, raw);

    expect(loadWorkspace(false)).toBeNull();
    expect(localStorage.getItem(FINE)).toBeNull();
  });

  it("I4 the coarse pointer reads and writes its own key", () => {
    saveWorkspace(true, emptyLayout("phone.md"), false);

    expect(loadWorkspace(false)).toBeNull();
    expect(loadWorkspace(true)?.layout.tabs[0]?.root).toMatchObject({ path: "phone.md" });
    expect(localStorage.getItem(FINE)).toBeNull();
  });

  it("I5 the saved workspace holds no note text", () => {
    saveWorkspace(false, emptyLayout("index.md"), true);

    expect(JSON.parse(localStorage.getItem(FINE) ?? "")).toEqual({
      layout: {
        tabs: [
          {
            id: expect.any(String),
            root: { id: expect.any(String), path: "index.md" },
            focus: expect.any(String),
          },
        ],
        active: 0,
      },
      treeOpen: true,
    });
  });

  it("I6 the last write wins, whole", () => {
    saveWorkspace(false, sample(), true);
    saveWorkspace(false, emptyLayout("other.md"), false);

    const back = loadWorkspace(false);

    expect(back?.treeOpen).toBe(false);
    expect(back?.layout.tabs).toHaveLength(1);
    expect(back?.layout.tabs[0]?.root).toMatchObject({ path: "other.md" });
  });

  it("I7 a storage that refuses every touch saves nothing and loads nothing", () => {
    const refused = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(refused);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(refused);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(refused);

    expect(() => saveWorkspace(false, emptyLayout("index.md"), true)).not.toThrow();
    expect(loadWorkspace(false)).toBeNull();
  });

  it("I7 a storage that refuses a bad key's removal still loads nothing", () => {
    localStorage.setItem(FINE, "{not json");
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(loadWorkspace(false)).toBeNull();
  });

  it("I8 restored ids never collide with ids made after the restore", () => {
    // Saved under the very ids this page's counter makes next, which is what
    // another page left behind looks like to this one.
    const next = Number(emptyLayout().tabs[0]?.focus.replace("pane", "")) + 1;
    const ids = (kind: string) => [0, 1, 2, 3].map((at) => `${kind}${next + at}`);
    const [p0, p1, p2] = ids("pane");
    const [t0] = ids("tab");
    const [s0] = ids("split");
    localStorage.setItem(
      FINE,
      JSON.stringify({
        layout: {
          tabs: [
            {
              id: t0,
              root: { id: s0, dir: "row", children: [{ id: p0 }, { id: p1 }, { id: p2 }] },
              focus: p0,
            },
          ],
          active: 0,
        },
        treeOpen: true,
      }),
    );
    const back = loadWorkspace(false)?.layout as Layout;

    const after = splitFocused(addTab(back), "row");

    const all = idsOf(after);
    expect(new Set(all).size).toBe(all.length);
  });
});
