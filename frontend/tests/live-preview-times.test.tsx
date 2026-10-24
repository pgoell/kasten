import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { fireEvent, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { followOnClick, followOnTap } from "@/lib/editor-follow";
import { livePreview } from "@/lib/live-preview";
import { timeSeek } from "@/lib/live-preview-times";
import { vimKeys } from "@/lib/vim-mode";
import { vaultPaths } from "@/lib/wikilink";
import { liveHooks, mount, plain } from "./live-preview-fixture";

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
      expect(seek).toHaveBeenCalledWith(31);
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

    expect(seek).toHaveBeenCalledWith(754);
    expect(open).not.toHaveBeenCalled();
  });
});
