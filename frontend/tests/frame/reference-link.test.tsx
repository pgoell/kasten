/**
 * Whether a reference link with a definition paints as a link (#439), and one
 * with none as the words around it, at a phone's width and a desktop's.
 *
 * jsdom computes no colours, so this runs in a real browser, mounted bare with
 * what the editor draws a note with: the note language, kastenTheme and live
 * preview.
 */

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { page } from "vitest/browser";
import { kastenTheme } from "@/lib/editor-theme";
import { imagePaths } from "@/lib/image";
import { livePreview } from "@/lib/live-preview";
import { noteLanguage } from "@/lib/note-language";
import { vimKeys } from "@/lib/vim-mode";
import { vaultPaths } from "@/lib/wikilink";
import { shot } from "./shots";
import "@/styles/app.css";

let view: EditorView | undefined;

afterEach(async () => {
  view?.dom.parentElement?.remove();
  view?.destroy();
  view = undefined;
  await page.viewport(414, 896);
});

/** The element painting the first text node in `line` that reads `text`. */
function painting(line: Element, text: string): Element {
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.textContent?.trim() === text) return node.parentElement as Element;
  }
  throw new Error(`no ${text} in ${line.textContent}`);
}

function look(el: Element): { color: string; line: string } {
  const style = getComputedStyle(el);
  return { color: style.color, line: style.textDecorationLine };
}

const DOC = [
  "see [docs] here",
  "a [full one][ref] and [Docs][] too",
  "an [undefined] one",
  "",
  "[docs]: https://example.com",
  '[ref]: https://example.org "Title"',
];

it.each([
  [414, 896],
  [1280, 900],
])(
  "paints a defined reference as a link and an undefined one as text at %i",
  async (width, height) => {
    await page.viewport(width, height);
    const parent = document.body.appendChild(document.createElement("div"));
    view = new EditorView({
      state: EditorState.create({
        doc: DOC.join("\n"),
        // On the blank line, so every line around it draws.
        selection: { anchor: DOC.slice(0, 3).join("\n").length + 1 },
        extensions: [
          noteLanguage(),
          kastenTheme,
          vimKeys.of(false),
          livePreview(),
          vaultPaths.of([]),
          imagePaths.of([]),
        ],
      }),
      parent,
    });
    const lines = [...view.contentDOM.querySelectorAll(".cm-line")];
    const plain = look(painting(lines[0] as Element, "see"));
    /** How `text` on line `n` paints, set against the plain words. */
    const paint = (n: number, text: string) => {
      const drawn = look(painting(lines[n] as Element, text));
      return { text, line: drawn.line, linkColour: drawn.color !== plain.color };
    };

    expect(await shot(view.dom, `reference-link-${width}`)).toBe(width);
    expect(lines[2]?.textContent).toBe("an [undefined] one");
    expect(look(painting(lines[2] as Element, "undefined"))).toEqual(
      look(painting(lines[2] as Element, "an")),
    );
    expect(lines[4]?.textContent).toBe(DOC[4]);
    expect(lines[5]?.textContent).toBe(DOC[5]);
    // Read in one, so every link's paint and the lines' text are reported together.
    expect({
      paints: [paint(0, "docs"), paint(1, "full one"), paint(1, "Docs")],
      lines: [lines[0]?.textContent, lines[1]?.textContent],
    }).toEqual({
      paints: [
        { text: "docs", line: "underline", linkColour: true },
        { text: "full one", line: "underline", linkColour: true },
        { text: "Docs", line: "underline", linkColour: true },
      ],
      lines: ["see docs here", "a full one and Docs too"],
    });
  },
);
