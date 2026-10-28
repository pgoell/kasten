/**
 * A pane keeps its editor when the tab's layout changes around it (#932): a note
 * with a split opened beside it, a split closed back to one pane, and a phone at
 * 414 px. The editor keeps its node, so its undo history and its cursor stay.
 *
 * The pane's own unit tests are in `pane-layout.test.tsx`. These are real browser
 * cases, because React's remount is what loses the history, and jsdom has no
 * CodeMirror to lose it.
 */

import { EditorView } from "@codemirror/view";
import { getCM } from "@replit/codemirror-vim";
import { waitFor } from "@testing-library/react";
import { act } from "react";
import { userEvent } from "vitest/browser";
import { fetchNote } from "@/lib/api";
import {
  DESKTOP,
  leader,
  type Mounted,
  mount,
  need,
  PATIENCE,
  READER,
  registerReaderFixture,
  type Size,
  unmount,
  visibleEditor,
} from "./reader-fixture";
import { registerNotes, TALK, talkNote, VIDEO } from "./video-pane-fixture";

/** What the saves wrote, by path, so a note written and opened again reads back what was typed. */
const { saved } = vi.hoisted(() => ({ saved: new Map<string, string>() }));

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    fetchFiles: vi.fn(),
    fetchNote: vi.fn(),
    // Never answers: the pdf beside a note only has to be a pane, not a page drawn.
    fetchBook: () => new Promise<never>(() => {}),
    saveNote: async (path: string, content: string) => {
      saved.set(path, content);
      return { path, content };
    },
    searchNotes: vi.fn(),
    fetchTodos: vi.fn(),
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

vi.mock("@/lib/video/video", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/video/video")>()),
  playerUrl: () => "about:blank",
}));

registerReaderFixture();
registerNotes({ [TALK]: talkNote(VIDEO) });

// Opening a note that was just written reads the write back, as the vault does.
// A split beside a note writes it first, so the editor opened again must hold
// what was typed.
beforeEach(() => {
  const previous = vi.mocked(fetchNote).getMockImplementation();
  vi.mocked(fetchNote).mockImplementation(async (path: string) => {
    const text = saved.get(path);
    if (text !== undefined) return text;
    if (previous === undefined) throw new Error(`no note ${path}`);
    return previous(path);
  });
});

afterEach(() => saved.clear());

const PHONE: Size = { name: "phone-414", width: 414, height: 896, coarse: true };
const READ = `/?note=${encodeURIComponent(READER)}`;
const VIDEO_NOTE = `/?note=${encodeURIComponent(TALK)}`;
const PDF = "00 Inbox/02 Documents/Fixture.pdf";

/** A saved desktop workspace: the note in a row beside a pdf, so the route restores both. */
function noteBesidePdf(note: string): Record<string, string> {
  const layout = {
    tabs: [
      {
        id: "tab-a",
        focus: "pane-note",
        root: {
          id: "split-a",
          dir: "row",
          children: [
            { id: "pane-note", path: note },
            { id: "pane-pdf", pdf: { path: PDF } },
          ],
        },
      },
    ],
    active: 0,
  };
  return { "kasten.workspace.1": JSON.stringify({ layout, treeOpen: false }) };
}

/** The note open at one size, with vim as the storage says (on when none is given). */
async function open(
  route: string,
  storage: Record<string, string> = {},
  size: Size = DESKTOP,
): Promise<Mounted> {
  const mounted = await mount(size, "light", route, "[data-reader-grid]", storage);
  await waitFor(() => expect(visibleEditor(mounted.host).textContent).not.toBe(""), PATIENCE);
  return mounted;
}

/** The id of the first pane drawn, which is the note's pane before any split. */
function firstId(host: HTMLElement): string {
  return need(host.querySelector<HTMLElement>("[data-pane]")?.dataset.pane, "pane");
}

/** The editor drawn inside the pane with this id. */
function editorIn(host: HTMLElement, id: string): HTMLElement {
  return need(
    host.querySelector<HTMLElement>(`[data-pane="${id}"] .cm-content`),
    `editor in pane ${id}`,
  );
}

async function waitForPanes(host: HTMLElement, count: number) {
  await waitFor(() => expect(host.querySelectorAll("[data-pane]").length).toBe(count), PATIENCE);
}

/** Runs a command by its label from the palette, which Ctrl+Shift+P opens with vim on or off. */
async function runFromPalette(label: string) {
  await userEvent.keyboard("{Control>}{Shift>}P{/Shift}{/Control}");
  const row = () =>
    [...document.querySelectorAll<HTMLElement>("[role='option']")].find((option) =>
      option.textContent?.startsWith(label),
    );
  await expect.poll(row).toBeDefined();
  await act(async () => row()?.click());
}

/** Types one word into the editor in insert mode, then leaves insert mode. */
async function typeWithVim(editor: HTMLElement) {
  await userEvent.click(editor);
  await userEvent.keyboard("i");
  await userEvent.keyboard("zebra");
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => editor.textContent).toContain("zebra");
}

describe("a pane keeps its editor when the layout changes around it", () => {
  let mounted: Mounted | undefined;

  afterEach(async () => {
    if (mounted) await unmount(mounted);
    mounted = undefined;
  });

  it("#932 A1 Space g v beside a lone note keeps its editor node", async () => {
    mounted = await open(VIDEO_NOTE);
    const { host } = mounted;
    const id = firstId(host);
    const editor = editorIn(host, id);

    leader(host, [" ", "g", "v"]);
    await waitForPanes(host, 2);

    expect(editorIn(host, id)).toBe(editor);
  });

  it("#932 A2 Space % keeps the undo history: u undoes the word typed before the split", async () => {
    mounted = await open(READ);
    const { host } = mounted;
    const id = firstId(host);
    await typeWithVim(editorIn(host, id));

    leader(host, [" ", "%"]);
    await waitForPanes(host, 2);
    // The word is still in the editor, so the undo below is what takes it out; a remount would have reset the text.
    expect.soft(editorIn(host, id).textContent).toContain("zebra");

    await userEvent.click(editorIn(host, id));
    await userEvent.keyboard("u");
    expect(editorIn(host, id).textContent).not.toContain("zebra");
  });

  it("#932 A2b Space % keeps the cursor and the vim visual selection of the first pane", async () => {
    mounted = await open(READ);
    const { host } = mounted;
    const id = firstId(host);
    // `G` ends on the note's blank last line, so `k` moves up to a paragraph, and `v` `l` `l` `l` selects three letters.
    await userEvent.click(editorIn(host, id));
    await userEvent.keyboard("Gk");
    await userEvent.keyboard("vlll");
    const before = need(EditorView.findFromDOM(editorIn(host, id)), "editor view");
    const { anchor, head } = before.state.selection.main;
    expect(anchor).not.toBe(head);
    expect(getCM(before)?.state.vim?.visualMode).toBe(true);

    // The palette, because the leader's own keys are not what this case is about.
    await runFromPalette("Split the pane left and right");
    await waitForPanes(host, 2);

    // A remounted editor restores the cursor from `kasten.positions`, but not the visual mode.
    const after = need(EditorView.findFromDOM(editorIn(host, id)), "editor view after split");
    expect.soft(after.state.selection.main.anchor).toBe(anchor);
    expect.soft(after.state.selection.main.head).toBe(head);
    expect(getCM(after)?.state.vim?.visualMode).toBe(true);
  });

  it("#932 A4 closing back to one pane keeps the survivor's editor", async () => {
    mounted = await open(READ);
    const { host } = mounted;
    const id = firstId(host);
    const editor = editorIn(host, id);
    await typeWithVim(editor);

    leader(host, [" ", "%"]);
    await waitForPanes(host, 2);

    // The focus is on the empty pane the split made, which Space q closes.
    await userEvent.keyboard(" ");
    await userEvent.keyboard("q");
    await waitForPanes(host, 1);

    expect.soft(editorIn(host, id)).toBe(editor);
    await userEvent.click(editorIn(host, id));
    await userEvent.keyboard("u");
    expect(editorIn(host, id).textContent).not.toContain("zebra");
  });

  it("#932 I1 vim off: a split from the palette keeps the editor and Ctrl+Z undoes the word", async () => {
    mounted = await open(READ, { "kasten.vim": "off" });
    const { host } = mounted;
    const id = firstId(host);
    const editor = editorIn(host, id);
    await userEvent.click(editor);
    await userEvent.keyboard("zebra");
    await expect.poll(() => editor.textContent).toContain("zebra");

    await runFromPalette("Split the pane left and right");
    await waitForPanes(host, 2);
    expect.soft(editorIn(host, id)).toBe(editor);

    await userEvent.click(editorIn(host, id));
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(editorIn(host, id).textContent).not.toContain("zebra");
  });

  it("#932 I2 a phone at 414 keeps the editor across a split and back", async () => {
    mounted = await open(READ, {}, PHONE);
    const { host } = mounted;
    const id = firstId(host);
    const editor = editorIn(host, id);

    leader(host, [" ", "%"]);
    await waitForPanes(host, 2);
    expect.soft(editorIn(host, id)).toBe(editor);

    // The focus is on the empty pane the split made, which Space q closes.
    await userEvent.keyboard(" ");
    await userEvent.keyboard("q");
    await waitForPanes(host, 1);
    expect(editorIn(host, id)).toBe(editor);
  });

  it("#935 A5 a pane in a row divided the other way keeps its editor: the cursor stays and u undoes the word", async () => {
    mounted = await open(READ);
    const { host } = mounted;
    const id = firstId(host);
    const editor = editorIn(host, id);

    leader(host, [" ", "%"]);
    await waitForPanes(host, 2);
    await typeWithVim(editorIn(host, id));
    const head = need(EditorView.findFromDOM(editorIn(host, id)), "editor view").state.selection
      .main.head;

    // The word is typed and left in normal mode, so the focus is in the note: Space " divides it.
    await userEvent.keyboard(" ");
    await userEvent.keyboard('"');
    await waitForPanes(host, 3);

    expect.soft(editorIn(host, id)).toBe(editor);
    expect
      .soft(
        need(EditorView.findFromDOM(editorIn(host, id)), "editor view").state.selection.main.head,
      )
      .toBe(head);
    await userEvent.click(editorIn(host, id));
    await userEvent.keyboard("u");
    expect(editorIn(host, id).textContent).not.toContain("zebra");
  });

  it("#935 A6 Space g v on a note beside a pdf keeps the note's editor: u undoes the word", async () => {
    mounted = await open("/", noteBesidePdf(TALK));
    const { host } = mounted;
    const id = firstId(host);
    const editor = editorIn(host, id);
    await typeWithVim(editor);

    leader(host, [" ", "g", "v"]);
    await waitForPanes(host, 3);

    expect.soft(editorIn(host, id)).toBe(editor);
    expect.soft(editorIn(host, id).textContent).toContain("zebra");
    await userEvent.click(editorIn(host, id));
    await userEvent.keyboard("u");
    expect(editorIn(host, id).textContent).not.toContain("zebra");
  });

  it("#935 A7 closing the other pane of a column folds it back into the row and keeps the editor", async () => {
    mounted = await open(READ);
    const { host } = mounted;
    const id = firstId(host);
    const editor = editorIn(host, id);
    await typeWithVim(editor);

    // The note's row, then a column dividing the note itself: closing the pane
    // the column made folds the note back into the row, and the note is moved.
    leader(host, [" ", "%"]);
    await waitForPanes(host, 2);
    await userEvent.click(editorIn(host, id));
    await userEvent.keyboard(" ");
    await userEvent.keyboard('"');
    await waitForPanes(host, 3);
    await userEvent.keyboard(" ");
    await userEvent.keyboard("q");
    await waitForPanes(host, 2);

    expect.soft(editorIn(host, id)).toBe(editor);
    await userEvent.click(editorIn(host, id));
    await userEvent.keyboard("u");
    expect(editorIn(host, id).textContent).not.toContain("zebra");
  });

  it("#935 I4 vim off: a nested split keeps the editor, and Ctrl+Z undoes the word", async () => {
    mounted = await open(READ, { "kasten.vim": "off" });
    const { host } = mounted;
    const id = firstId(host);
    const editor = editorIn(host, id);
    await userEvent.click(editor);
    await userEvent.keyboard("zebra");
    await expect.poll(() => editor.textContent).toContain("zebra");

    await runFromPalette("Split the pane left and right");
    await waitForPanes(host, 2);
    await userEvent.click(editorIn(host, id));
    await runFromPalette("Split the pane top and bottom");
    await waitForPanes(host, 3);
    expect.soft(editorIn(host, id)).toBe(editor);

    await userEvent.click(editorIn(host, id));
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(editorIn(host, id).textContent).not.toContain("zebra");
  });

  it("#935 I5 a phone at 414 keeps the editor across a nested split and back", async () => {
    mounted = await open(READ, {}, PHONE);
    const { host } = mounted;
    const id = firstId(host);
    const editor = editorIn(host, id);

    leader(host, [" ", "%"]);
    await waitForPanes(host, 2);
    // A phone draws only the focused pane, so the note comes back by Space o, not a click.
    await userEvent.keyboard(" ");
    await userEvent.keyboard("o");
    await userEvent.keyboard(" ");
    await userEvent.keyboard('"');
    await waitForPanes(host, 3);
    expect.soft(editorIn(host, id)).toBe(editor);

    // The focus is on the empty pane the column made, and each Space q closes the empty pane in focus.
    await userEvent.keyboard(" ");
    await userEvent.keyboard("q");
    await waitForPanes(host, 2);
    await userEvent.keyboard(" ");
    await userEvent.keyboard("q");
    await waitForPanes(host, 1);
    expect(editorIn(host, id)).toBe(editor);
  });

  it("#935 I6 a word typed right before a nested split and not saved is still there", async () => {
    mounted = await open(READ);
    const { host } = mounted;
    const id = firstId(host);
    const editor = editorIn(host, id);

    leader(host, [" ", "%"]);
    await waitForPanes(host, 2);
    await typeWithVim(editorIn(host, id));
    await userEvent.keyboard(" ");
    await userEvent.keyboard('"');
    await waitForPanes(host, 3);

    // A remounted editor reads the note back, which is how a word typed and not yet written would go.
    expect.soft(editorIn(host, id)).toBe(editor);
    expect(editorIn(host, id).textContent).toContain("zebra");
  });
});
