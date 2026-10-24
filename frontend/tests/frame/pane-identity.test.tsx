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

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    fetchFiles: vi.fn(),
    fetchNote: vi.fn(),
    saveNote: async (path: string, content: string) => ({ path, content }),
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

vi.mock("@/lib/graph-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/graph-api")>()),
  fetchGraph: vi.fn(),
}));

vi.mock("@/lib/video", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/video")>()),
  playerUrl: () => "about:blank",
}));

registerReaderFixture();
registerNotes({ [TALK]: talkNote(VIDEO) });

const PHONE: Size = { name: "phone-414", width: 414, height: 896, coarse: true };
const READ = `/?note=${encodeURIComponent(READER)}`;
const VIDEO_NOTE = `/?note=${encodeURIComponent(TALK)}`;

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
});
