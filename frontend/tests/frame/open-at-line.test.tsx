/**
 * #950: a note opened on a line keeps that line on screen. A todo click, a search
 * hit and a backlink each open their note at a line, and the line has to be drawn
 * with the cursor on it, in Read and in Edit mode, for a note not yet open, for
 * one open in another tab or pane, and on a phone.
 *
 * Each test seeds the workspace the way a reload finds it, then makes the open.
 * The line is read after the fonts are in, so late layout cannot make it look shown.
 */

import { EditorView } from "@codemirror/view";
import { fireEvent, waitFor } from "@testing-library/react";
import { fetchFiles, fetchNote, fetchTodos, NoteMissing, searchNotes } from "@/lib/api";
import { fetchGraph } from "@/lib/graph/graph-api";
import { readMode } from "@/lib/note/note-head";
import {
  DESKTOP,
  fontsIn,
  leader,
  type Mounted,
  mount,
  need,
  PATIENCE,
  registerReaderFixture,
  TOUCH,
  unmount,
  visibleEditor,
} from "./reader-fixture";

const { saveNote } = vi.hoisted(() => ({
  saveNote: vi.fn(async (path: string, content: string) => ({ path, content })),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    fetchFiles: vi.fn(),
    fetchNote: vi.fn(),
    saveNote,
    searchNotes: vi.fn(),
    fetchTodos: vi.fn(),
    fetchMentions: async () => [],
    fetchImages: async () => [],
    fetchHtml: async () => [],
    fetchAssets: async () => [],
    fetchTags: async () => [],
    fetchTerminals: async () => [],
    fetchVersion: async () => "0.8.0",
    fetchWeather: async () => [],
  };
});

vi.mock("@/lib/trash-api", async (original) => ({
  ...(await original<typeof import("@/lib/trash-api")>()),
  fetchTrash: async () => [],
}));

vi.mock("@/lib/graph/graph-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/graph/graph-api")>()),
  fetchGraph: vi.fn(),
}));

registerReaderFixture();

// The keys the fixture's helpers use, which the fixture does not export.
const VIM_KEY = "kasten.vim";
const WORKSPACE_KEY = "kasten.workspace.1";
const WORKSPACE_KEY_COARSE = "kasten.workspace.coarse.1";

const LONG = "Long.md";
const START = "Start.md";
const TARGET = "Target.md";

/** The line the far todo sits on, well past the first screen of the note. */
const LINE = 150;
const TODO_TEXT = "- [ ] the far todo";
/** The far line also links to Target, which makes it a backlink of Target. */
const LINKED_LINE = `${TODO_TEXT} [[Target]]`;

/** Lines one to three are a frontmatter block, so the reader head draws. */
const FRONT = ["---", "id: long-note", "---"];

const LONG_TEXT = Array.from({ length: 200 }, (_, index) => {
  const line = index + 1;
  if (line <= FRONT.length) return FRONT[index];
  if (line === LINE) return LINKED_LINE;
  return `Long line ${line}, a line of text.`;
}).join("\n");

const NOTES: Record<string, string> = {
  [LONG]: LONG_TEXT,
  [START]: "# Start\n",
  [TARGET]: "# Target\n",
};

const TODOS = [{ path: LONG, line: LINE, text: TODO_TEXT, project: null, shared: false }];

const HIT = { path: LONG, line: LINE, text: TODO_TEXT };
const BACKLINK = { path: LONG, line: LINE, text: LINKED_LINE };

// Target is linked from Long, on the far line: the backlink is that line.
const GRAPH = {
  nodes: [
    { path: TARGET, name: "Target", type: null, tags: [], missing: false },
    { path: LONG, name: "Long", type: null, tags: [], missing: false },
  ],
  edges: [{ source: LONG, target: TARGET, relation: null, line: LINE }],
  columns: [],
  rows: [],
  truncated: false,
};

/** One pane, and the workspace around it, as a reload finds it. */
function oneTab(root: object, focus = "p1") {
  return { layout: { tabs: [{ id: "t1", root, focus }], active: 0 }, treeOpen: false };
}

const TODO_ALONE = oneTab({ id: "p1", todos: true });
const START_ALONE = oneTab({ id: "p1", path: START });
const TARGET_ALONE = oneTab({ id: "p1", path: TARGET });

// The todo pane in the active tab, the long note open in another.
const TODO_AND_OTHER_TAB = {
  layout: {
    tabs: [
      { id: "t1", root: { id: "p1", todos: true }, focus: "p1" },
      { id: "t2", root: { id: "p2", path: LONG }, focus: "p2" },
    ],
    active: 0,
  },
  treeOpen: false,
};

// A note in the active tab, which the todo pane takes over, and the long note in another.
const START_AND_OTHER_TAB = {
  layout: {
    tabs: [
      { id: "t1", root: { id: "p1", path: START }, focus: "p1" },
      { id: "t2", root: { id: "p2", path: LONG }, focus: "p2" },
    ],
    active: 0,
  },
  treeOpen: false,
};

// The todo pane beside the long note, in the same tab.
const TODO_BESIDE_NOTE = {
  layout: {
    tabs: [
      {
        id: "t1",
        root: {
          dir: "row",
          id: "s1",
          children: [
            { id: "p1", todos: true },
            { id: "p2", path: LONG },
          ],
        },
        focus: "p1",
      },
    ],
    active: 0,
  },
  treeOpen: false,
};

beforeEach(() => {
  saveNote.mockClear();
  vi.mocked(fetchFiles).mockImplementation(async () => Object.keys(NOTES));
  vi.mocked(fetchNote).mockImplementation(async (path: string) => {
    const text = NOTES[path];
    if (text === undefined) throw new NoteMissing(path);
    return text;
  });
  vi.mocked(fetchTodos).mockImplementation(async () => TODOS);
  vi.mocked(searchNotes).mockImplementation(async (query: string) => {
    if (query === "far todo") return [HIT];
    if (query.toLowerCase() === "target") return [BACKLINK];
    return [];
  });
  vi.mocked(fetchGraph).mockImplementation(async () => GRAPH);
});

/** Mounts the workspace at one size, with vim on unless `vim` says otherwise. */
function mountWith(workspace: object, size = DESKTOP, vim = "on"): Promise<Mounted> {
  // A touch screen keeps its own workspace, so the layout is seeded under its key.
  const key = size.coarse ? WORKSPACE_KEY_COARSE : WORKSPACE_KEY;
  return mount(size, "light", "/", "[data-pane]", {
    [key]: JSON.stringify(workspace),
    [VIM_KEY]: vim,
  });
}

/** Waits for the note on screen to hold `text`, so a key or a click finds its editor. */
async function editorHolds(host: HTMLElement, text: string) {
  await waitFor(() => expect(visibleEditor(host).textContent).toContain(text), PATIENCE);
}

/** The todo row for the far todo, which opens its note on a click. */
async function clickTodo(host: HTMLElement) {
  const row = await waitFor(
    () =>
      need(
        [...host.querySelectorAll<HTMLElement>("[data-row]")].find((each) =>
          each.textContent?.includes("the far todo"),
        ),
        "row of the far todo",
      ),
    PATIENCE,
  );
  // A press focuses the row first, as a click in a browser does, so the pane
  // holding the list is the focused one the note opens into.
  row.focus();
  fireEvent.click(row);
}

/** `Space g t`: the todo list put in the focused pane, the way the app puts it. */
function openTodos(host: HTMLElement) {
  leader(host, [" ", "g", "t"]);
}

/** The editor of the pane `pane` names, or of the one on screen when no pane is named. */
function editorOf(host: HTMLElement, pane?: string): HTMLElement {
  if (pane === undefined) return visibleEditor(host);
  return need(
    host.querySelector<HTMLElement>(`[data-pane="${pane}"] .cm-content`),
    `editor of pane ${pane}`,
  );
}

/**
 * The far line is drawn inside the editor's scroll box, and the cursor is on it.
 *
 * `read` says which mode the editor must be in: true for Read (live preview on),
 * false for Edit. The line is checked after the fonts are in, the way a reader sees it.
 */
async function expectLineShown(
  host: HTMLElement,
  { pane, read }: { pane?: string; read?: boolean } = {},
): Promise<void> {
  const viewNow = () => need(EditorView.findFromDOM(editorOf(host, pane)), "editor view");
  await waitFor(() => {
    const current = viewNow();
    expect(current.state.doc.toString(), "the note on screen").toContain(TODO_TEXT);
    expect(current.state.selection.main.head).toBe(current.state.doc.line(LINE).from);
  }, PATIENCE);
  await fontsIn();

  const view = viewNow();
  const { from } = view.state.doc.line(LINE);
  if (read !== undefined) expect(view.state.facet(readMode)).toBe(read);
  expect(view.state.selection.main.head).toBe(from);
  expect(
    view.visibleRanges.some((range) => range.from <= from && from <= range.to),
    `line ${LINE} is not drawn`,
  ).toBe(true);

  const point = view.domAtPos(from);
  const node = point.node instanceof Element ? point.node : point.node.parentElement;
  const element = need(node?.closest<HTMLElement>(".cm-line"), `element of line ${LINE}`);
  const box = element.getBoundingClientRect();
  const frame = view.scrollDOM.getBoundingClientRect();
  expect(box.top).toBeGreaterThanOrEqual(frame.top);
  expect(box.bottom).toBeLessThanOrEqual(frame.bottom);
  expect(view.scrollDOM.scrollTop).toBeGreaterThan(0);
}

it("A1 a todo click opens its note on the line, in Read mode", async () => {
  const mounted = await mountWith(TODO_ALONE);
  try {
    await clickTodo(mounted.host);
    await expectLineShown(mounted.host, { read: true });
  } finally {
    await unmount(mounted);
  }
});

it("A2 a todo click opens its note on the line, in Edit mode", async () => {
  const mounted = await mountWith(START_ALONE);
  try {
    const { host } = mounted;
    await editorHolds(host, "Start");
    leader(host, [" ", "p"]);
    openTodos(host);
    await clickTodo(host);
    await expectLineShown(host, { read: false });
  } finally {
    await unmount(mounted);
  }
});

it("A3 a todo click on a note open in another tab shows the line, in Read mode", async () => {
  const mounted = await mountWith(TODO_AND_OTHER_TAB);
  try {
    await clickTodo(mounted.host);
    await expectLineShown(mounted.host, { read: true });
  } finally {
    await unmount(mounted);
  }
});

it("A4 a todo click on a note open in another tab shows the line, in Edit mode", async () => {
  const mounted = await mountWith(START_AND_OTHER_TAB);
  try {
    const { host } = mounted;
    await editorHolds(host, "Start");
    leader(host, [" ", "p"]);
    openTodos(host);
    await clickTodo(host);
    await expectLineShown(host, { read: false });
  } finally {
    await unmount(mounted);
  }
});

it("A5 a todo click on a note open in another pane shows the line", async () => {
  const mounted = await mountWith(TODO_BESIDE_NOTE);
  try {
    const { host } = mounted;
    // The layout is read again on mount and its pane ids are not the seeded ones,
    // so the pane is found by the list it holds, before the click replaces it.
    const todoPane = await waitFor(
      () =>
        need(host.querySelector<HTMLElement>("[data-pane]:has([data-row])"), "pane of the todos"),
      PATIENCE,
    );
    await clickTodo(host);
    await expectLineShown(host, {
      pane: need(todoPane.dataset.pane, "id of the todo pane"),
      read: true,
    });
  } finally {
    await unmount(mounted);
  }
});

it("A6 a search hit opens its note on the line", async () => {
  const mounted = await mountWith(START_ALONE);
  try {
    const { host } = mounted;
    await editorHolds(host, "Start");
    leader(host, [" ", "f", "g"]);
    const input = await waitFor(
      () => need(host.querySelector<HTMLInputElement>("input"), "search input"),
      PATIENCE,
    );
    fireEvent.change(input, { target: { value: "far todo" } });
    const hit = await waitFor(
      () =>
        need(
          [...host.querySelectorAll<HTMLElement>('[role="option"]')].find((each) =>
            each.textContent?.includes("far todo"),
          ),
          "search hit for the far todo",
        ),
      PATIENCE,
    );
    fireEvent.click(hit);
    await expectLineShown(host, { read: true });
  } finally {
    await unmount(mounted);
  }
});

it("A7 a backlink opens its note on the linking line", async () => {
  const mounted = await mountWith(TARGET_ALONE);
  try {
    const { host } = mounted;
    await editorHolds(host, "Target");
    // `Space g b` lists the lines that link here, and a line opens its note at the line.
    leader(host, [" ", "g", "b"]);
    const backlink = await waitFor(
      () =>
        need(
          [...host.querySelectorAll<HTMLElement>('[role="option"]')].find((each) =>
            each.textContent?.includes("far todo"),
          ),
          "backlink from the far line",
        ),
      PATIENCE,
    );
    fireEvent.click(backlink);
    await expectLineShown(host, { read: true });
  } finally {
    await unmount(mounted);
  }
});

it("I1 a todo click opens its note on the line with vim off", async () => {
  const mounted = await mountWith(TODO_ALONE, DESKTOP, "off");
  try {
    await clickTodo(mounted.host);
    await expectLineShown(mounted.host, { read: true });
  } finally {
    await unmount(mounted);
  }
});

it("I2 a tap on a todo opens its note on the line on a phone", async () => {
  const mounted = await mountWith(TODO_ALONE, TOUCH);
  try {
    await clickTodo(mounted.host);
    await expectLineShown(mounted.host, { read: true });
  } finally {
    await unmount(mounted);
  }
});

it("I3 a second click on the same todo after scrolling away brings the line back", async () => {
  const mounted = await mountWith(TODO_ALONE);
  try {
    const { host } = mounted;
    await clickTodo(host);
    await expectLineShown(host, { read: true });

    // The note is scrolled back to its top and the cursor moved to line one,
    // which is where a reader is after walking away from the todo.
    const view = need(EditorView.findFromDOM(visibleEditor(host)), "editor view");
    view.dispatch({ selection: { anchor: view.state.doc.line(1).from } });
    view.scrollDOM.scrollTop = 0;
    expect(view.scrollDOM.scrollTop).toBe(0);

    // The note replaced the todo list, so the list comes back the way the app brings it.
    openTodos(host);
    await clickTodo(host);
    await expectLineShown(host, { read: true });
  } finally {
    await unmount(mounted);
  }
});

it("I4 opening a todo's note writes nothing", async () => {
  const mounted = await mountWith(TODO_ALONE);
  try {
    await clickTodo(mounted.host);
    // The open is done once the note's text is in the editor. The line is left to A1.
    await waitFor(
      () =>
        expect(EditorView.findFromDOM(visibleEditor(mounted.host))?.state.doc.toString()).toContain(
          TODO_TEXT,
        ),
      PATIENCE,
    );

    // The autosave waits about a second before it writes, so a write would land in this wait.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(saveNote).not.toHaveBeenCalled();
  } finally {
    await unmount(mounted);
  }
});
