/**
 * Whether an image whose bare address holds a space draws its picture (#553),
 * at a phone's width and a desktop's.
 *
 * jsdom loads no image, so this runs in a real browser. The frame runner has
 * no backend behind `/api/assets`, so the picture is pointed at one drawn on a
 * canvas, as the table's pictures are, and the address the widget wrote is
 * checked last.
 */

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
// For its types alone: the provider is what gives `cdp()` a typed `send`.
import type {} from "@vitest/browser-playwright";
import { cdp, page } from "vitest/browser";
import { kastenTheme } from "@/lib/editor-theme";
import { imagePaths } from "@/lib/image";
import { livePreview } from "@/lib/live/live-preview";
import { noteLanguage } from "@/lib/note-language";
import { vimKeys } from "@/lib/vim-mode";
import { vaultPaths } from "@/lib/wikilink";
import "@/styles/app.css";
import { shot } from "./shots";

const NOTE = ["A shot", "", "![shot](99 Misc/shot.png)"].join("\n");

let view: EditorView | undefined;

afterEach(async () => {
  view?.dom.parentElement?.remove();
  view?.destroy();
  view = undefined;
  await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await page.viewport(414, 896);
});

/** A 320 by 180 PNG in one colour, as a data URL. */
function picture(colour: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const context = canvas.getContext("2d") as CanvasRenderingContext2D;
  context.fillStyle = colour;
  context.fillRect(0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

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
        imagePaths.of(["99 Misc/shot.png"]),
        EditorView.lineWrapping,
      ],
    }),
    parent,
  });
  view.dom.style.height = "100%";
  return view;
}

/**
 * The picture loaded from a canvas, and the address the widget wrote for it,
 * which each test checks last.
 */
async function loaded(at: EditorView): Promise<{ image: HTMLImageElement; src: string | null }> {
  await expect.poll(() => at.dom.querySelectorAll("img.cm-image").length).toBe(1);
  const image = at.dom.querySelector("img.cm-image") as HTMLImageElement;
  const src = image.getAttribute("src");
  image.src = picture("#61afef");
  await expect.poll(() => image.complete && image.naturalWidth > 0).toBe(true);
  return { image, src };
}

describe("a space in an image address (#553)", () => {
  it("A6 draws a spaced image address on a phone", async () => {
    await page.viewport(414, 896);
    await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    expect(matchMedia("(pointer: coarse)").matches).toBe(true);
    const at = mount(896);

    const { image, src } = await loaded(at);
    expect(image.getBoundingClientRect().right).toBeLessThanOrEqual(414);
    expect(at.contentDOM.textContent).not.toContain("(99");
    expect(await shot(at.dom, "spaced-image-414")).toBe(414);
    expect(src).toBe("/api/assets/99%20Misc/shot.png");
  });

  it("A6 draws a spaced image address on a desktop", async () => {
    await page.viewport(1280, 900);
    const at = mount(900);

    const { src } = await loaded(at);
    expect(at.contentDOM.textContent).not.toContain("(99");
    expect(await shot(at.dom, "spaced-image-1280")).toBe(1280);
    expect(src).toBe("/api/assets/99%20Misc/shot.png");
  });
});
