import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { followOnClick, followOnTap } from "@/lib/editor/editor-follow";
import { vimKeys } from "@/lib/editor/vim-mode";
import { livePreview } from "@/lib/live/live-preview";
import { timeSeek } from "@/lib/live/live-preview-times";
import { noteVideos } from "@/lib/video/video";
import { vaultPaths } from "@/lib/wikilink";
import { liveHooks, mount, parsed, plain } from "./live-preview-fixture";

// The real reader, counted, so a test can say how often a rebuild reads the note.
vi.mock("@/lib/video/video", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/video/video")>();
  return { ...actual, noteVideos: vi.fn(actual.noteVideos) };
});

liveHooks();

afterEach(() => {
  vi.restoreAllMocks();
});

const VIM = [
  ["vim on", true],
  ["vim off", false],
] as const;

/** A note that links a video, with a transcript time on the third line. */
const TALK = "intro\n\n[00:31] the first words\n\n[the talk](https://youtu.be/iDulhoQ2pro)\n";
const AT = TALK.indexOf("[00:31]");

function lit(
  vimOn: boolean,
  seek: (seconds: number) => void,
  extra: Extension[] = [],
): Extension[] {
  const base = vimOn
    ? [vim(), livePreview(), vaultPaths.of(["b.md"])]
    : [vimKeys.of(false), livePreview(), vaultPaths.of(["b.md"])];
  return [...base, timeSeek.of(seek), ...extra];
}

function buttons(view: EditorView): HTMLButtonElement[] {
  return [...view.dom.querySelectorAll<HTMLButtonElement>("button.cm-time")];
}

describe("times in a note are seek buttons (#791 A11)", () => {
  it.each(VIM)(
    "#791 A11 draws a transcript time off the cursor's line as a seek button: %s",
    (_, vimOn) => {
      const seek = vi.fn();
      const view = mount(TALK, lit(vimOn, seek));

      const [button] = buttons(view);
      expect(button?.textContent).toBe("00:31");
      expect(button?.getAttribute("aria-label")).toBe("Seek to 00:31");
      button?.click();
      // A bare time names no video, so the seek carries none.
      expect(seek).toHaveBeenCalledWith(31, undefined);
    },
  );

  it("#791 A11 a press on the time button is kept from the editor, so the cursor stays put", () => {
    const view = mount(TALK, lit(false, vi.fn()));

    const [button] = buttons(view);
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    button?.dispatchEvent(down);

    expect(down.defaultPrevented).toBe(true);
    expect(view.state.selection.main.head).toBe(0);
  });

  it.each(VIM)(
    "#791 A11 shows the time as typed on the cursor's own line: %s",
    async (_, vimOn) => {
      const view = mount(TALK, lit(vimOn, vi.fn()), AT);
      // Vim redraws the line once insert mode has been entered, which is not
      // at the key press itself.
      if (vimOn) fireEvent.keyDown(view.contentDOM, { key: "i" });

      await waitFor(() => expect(buttons(view)).toEqual([]));
      expect(view.contentDOM.textContent).toContain("[00:31] the first words");
    },
  );

  it("#791 A11 draws no time button in a note that links no video", () => {
    const view = mount("intro\n\n[00:31] the first words\n", plain(null));

    expect(buttons(view)).toEqual([]);
    expect(view.contentDOM.textContent).toContain("[00:31] the first words");
  });

  it("#791 A11 a take's time link draws a button that seeks to its second and opens no window", () => {
    const seek = vi.fn();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const take =
      "intro\n\n[12:34](https://www.youtube.com/watch?v=iDulhoQ2pro&t=754s) ^hl-abc123\n";
    const view = mount(take, lit(false, seek, [followOnClick(), followOnTap()]));

    const [button] = buttons(view);
    expect(button?.textContent).toBe("12:34");
    fireEvent.mouseDown(button as HTMLElement);
    fireEvent.click(button as HTMLElement);
    // A ctrl press on the button is the one the link's own handler would open.
    fireEvent.mouseDown(button as HTMLElement, { ctrlKey: true });
    fireEvent.click(button as HTMLElement);

    // The take names its video, so the seek carries the id as well.
    expect(seek).toHaveBeenCalledWith(754, "iDulhoQ2pro");
    expect(open).not.toHaveBeenCalled();
  });

  it("#791 R7 a take link at second 0 is a seek button", () => {
    const seek = vi.fn();
    const take = "intro\n\n[00:00](https://www.youtube.com/watch?v=iDulhoQ2pro) ^hl-abc123\n";
    const view = mount(take, lit(false, seek));

    const [button] = buttons(view);
    expect(button?.textContent).toBe("00:00");
    button?.click();
    expect(seek).toHaveBeenCalledWith(0, "iDulhoQ2pro");
  });

  it("#791 R7 the note's videos are read once per rebuild, not once per time", () => {
    const stamps = Array.from(
      { length: 50 },
      (_, n) => `[00:${String(n).padStart(2, "0")}] words ${n}`,
    ).join("\n\n");
    const doc = `${stamps}\n\n[the talk](https://youtu.be/iDulhoQ2pro)\n`;
    const view = mount(doc, lit(false, vi.fn()), doc.length);
    // The whole tree is read, not the lines on screen, which a view of no height shows few of.
    parsed(view);

    // One rebuild, which reads the note once for all fifty stamps.
    const reads = vi.mocked(noteVideos);
    reads.mockClear();
    act(() => view.dispatch({ changes: { from: doc.length, insert: "more" } }));
    expect(reads.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

it("#968 draws no button for a bracketed time that opens a reference definition", () => {
  const doc = "intro\n\n[00:31]: the first words\n\n[the talk](https://youtu.be/iDulhoQ2pro)\n";
  const view = mount(doc, lit(false, vi.fn()));

  expect(view.dom.querySelectorAll(".cm-time")).toHaveLength(0);
});
