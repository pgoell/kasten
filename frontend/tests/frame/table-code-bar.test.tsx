/**
 * Whether a `\|` in a code span in a table cell draws as the bar alone (#515),
 * at a phone's width and a desktop's.
 *
 * A look, so this runs in a real browser and takes a shot of each.
 */

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
// For its types alone: the provider is what gives `cdp()` a typed `send`.
import type {} from "@vitest/browser-playwright";
import { cdp, page } from "vitest/browser";
import { kastenTheme } from "@/lib/editor-theme";
import { imagePaths } from "@/lib/image";
import { livePreview } from "@/lib/live-preview";
import { noteLanguage } from "@/lib/note-language";
import { vimKeys } from "@/lib/vim-mode";
import { vaultPaths } from "@/lib/wikilink";
import "@/styles/app.css";
import { shot } from "./shots";

const NOTE = ["A table", "", "| code | text |", "| --- | --- |", "| `a \\| b` | plain |"].join(
  "\n",
);

let view: EditorView | undefined;

afterEach(async () => {
  view?.dom.parentElement?.remove();
  view?.destroy();
  view = undefined;
  await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await page.viewport(414, 896);
});

/**
 * The editor with kastenTheme and vim on, as `editor.tsx` mounts it, filling a
 * pane of the given height, the cursor on the first line.
 */
function mount(height: number): EditorView {
  const parent = document.body.appendChild(document.createElement("div"));
  parent.style.cssText = `width: 100%; height: ${height}px; background: #282c34;`;
  view = new EditorView({
    state: EditorState.create({
      doc: NOTE,
      extensions: [
        noteLanguage(),
        kastenTheme,
        vim(),
        vimKeys.of(true),
        livePreview(),
        vaultPaths.of([]),
        imagePaths.of([]),
        EditorView.lineWrapping,
      ],
    }),
    parent,
  });
  view.dom.style.height = "100%";
  return view;
}

/** The text of the code span in the drawn table's body. */
function code(at: EditorView): string | null | undefined {
  return at.dom.querySelector(".cm-table-grid tbody .cm-inline-code")?.textContent;
}

describe("an escaped bar in a code span in a table cell (#515)", () => {
  it("A6 draws the bar of a code span in a table cell on a phone", async () => {
    await page.viewport(414, 896);
    await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    expect(matchMedia("(pointer: coarse)").matches).toBe(true);
    const at = mount(896);

    expect(code(at)).toBe("a | b");
    expect(await shot(at.dom, "table-code-bar-phone")).toBe(414);
  });

  it("A6 draws the bar of a code span in a table cell on a desktop", async () => {
    await page.viewport(1280, 900);
    const at = mount(900);

    expect(code(at)).toBe("a | b");
    expect(await shot(at.dom, "table-code-bar-desktop")).toBe(1280);
  });
});
