/**
 * Pictures in a table's cells, drawn side by side (#504).
 *
 * jsdom loads no image and lays nothing out, so whether a picture in a cell
 * arrives, how wide the table then is and where a tap lands are answered here.
 * The frame runner has no backend behind `/api/assets`, so once the address
 * the widget writes is checked, each picture is pointed at one drawn on a
 * canvas. Nothing of the vault's goes near the repo.
 */

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
// For its types alone: the provider is what gives `cdp()` a typed `send`.
import type {} from "@vitest/browser-playwright";
import { cdp, page, userEvent } from "vitest/browser";
import { imagePaths } from "@/lib/image";
import { livePreview } from "@/lib/live-preview";
import { noteLanguage } from "@/lib/note-language";
import { notePath } from "@/lib/todo-commands";
import { vimKeys } from "@/lib/vim-mode";
import { vaultPaths } from "@/lib/wikilink";
import "@/styles/app.css";
import { shot } from "./shots";

const FOLDER = "99%20Misc/02%20Assets/01%20Images";
const PBI = `${FOLDER}/judge-01-pbi.png`;
const AIBI = `${FOLDER}/judge-01-aibi.png`;
const NOTE = [
  "Judge labels",
  "",
  "| Power BI | AI/BI |",
  "|---|---|",
  `| ![](${PBI}) | ![](${AIBI}) |`,
].join("\n");

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

/** The editor the way the app mounts a note, filling a pane of the given height. */
function mount(doc: string, height: number): EditorView {
  const parent = document.body.appendChild(document.createElement("div"));
  parent.style.cssText = `width: 100%; height: ${height}px; background: #282c34;`;
  view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        noteLanguage(),
        vimKeys.of(false),
        livePreview(),
        vaultPaths.of([]),
        imagePaths.of([]),
        notePath.of("02 Projects/AIBI Migration Plugin/Judge Labels 2026-10-18.md"),
        EditorView.lineWrapping,
      ],
    }),
    parent,
  });
  view.dom.style.height = "100%";
  return view;
}

/**
 * The two pictures in the table, checked for the address the app would load
 * and then loaded from a canvas, blue for Power BI.
 */
async function loaded(at: EditorView): Promise<HTMLImageElement[]> {
  await expect.poll(() => at.dom.querySelectorAll(".cm-table-grid img").length).toBe(2);
  const images = [...at.dom.querySelectorAll<HTMLImageElement>(".cm-table-grid img.cm-image")];
  expect(images.map((image) => image.getAttribute("src"))).toEqual([
    `/api/assets/${PBI}`,
    `/api/assets/${AIBI}`,
  ]);
  images.forEach((image, at) => {
    image.src = picture(at === 0 ? "#61afef" : "#d19a66");
  });
  await expect
    .poll(() => images.filter((image) => image.complete && image.naturalWidth > 0).length)
    .toBe(2);
  return images;
}

/** A phone: 414 wide and a finger for a pointer, which is what `pointer: coarse` reads. */
async function phone(): Promise<void> {
  await page.viewport(414, 896);
  await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  expect(matchMedia("(pointer: coarse)").matches).toBe(true);
}

describe("pictures in a table", () => {
  it("A4 draws both pictures on a phone, and a tap on the table shows its source", async () => {
    await phone();
    const at = mount(NOTE, 896);

    const images = await loaded(at);
    // Side by side, the way Obsidian draws them, and inside the pane.
    const [left, right] = images.map((image) => image.getBoundingClientRect());
    // Within a pixel: each column shrinks its picture to a width of its own.
    expect(Math.abs((left?.top ?? 0) - (right?.top ?? 1000))).toBeLessThan(1);
    expect(right?.right).toBeLessThanOrEqual(414);
    expect(await shot(at.dom, "table-images-414")).toBe(414);

    await userEvent.click(at.dom.querySelector(".cm-table-grid") as Element);
    await expect.poll(() => at.dom.querySelector(".cm-table-grid")).toBeNull();
    expect(at.contentDOM.textContent).toContain(`| ![](${PBI}) |`);
  });

  it("A4 draws both pictures on a desktop", async () => {
    await page.viewport(1200, 900);
    const at = mount(NOTE, 900);

    await loaded(at);
    expect(await shot(at.dom, "table-images-1200")).toBe(1200);
  });

  it("I1 scrolls a table wider than the pane inside its block, not the note", async () => {
    await phone();
    // The editor wraps a word anywhere, so a long one would only make a tall
    // cell. Thirty columns, each with its padding and border, cannot wrap.
    const row = (cell: string) => `|${` ${cell} |`.repeat(30)}`;
    const at = mount(["Judge labels", "", row("ab"), row("-"), row("cd")].join("\n"), 896);

    // The parse can land a frame after the mount, the first run of a fresh
    // stylesheet being slow enough to show it.
    await expect.poll(() => at.dom.querySelector(".cm-table-block")).not.toBeNull();
    const block = at.dom.querySelector(".cm-table-block") as HTMLElement;
    expect(block.scrollWidth).toBeGreaterThan(block.clientWidth);
    expect(at.scrollDOM.scrollWidth).toBeLessThanOrEqual(at.scrollDOM.clientWidth);
  });
});
