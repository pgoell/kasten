/**
 * Whether a `[text]` with no `(url)` paints as the words around it (#441).
 *
 * jsdom computes no colours, so the cascade between the highlighter's classes
 * and app.css is only answered in a real browser. Mounted bare with what the
 * editor draws a note with: the note language, kastenTheme and live preview.
 */

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { kastenTheme } from "@/lib/editor-theme";
import { imagePaths } from "@/lib/image";
import { livePreview } from "@/lib/live-preview";
import { noteLanguage } from "@/lib/note-language";
import { vimKeys } from "@/lib/vim-mode";
import { vaultPaths } from "@/lib/wikilink";
import "@/styles/app.css";

let view: EditorView | undefined;

afterEach(() => {
  view?.dom.parentElement?.remove();
  view?.destroy();
  view = undefined;
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

it("paints a [text] as the words around it, a real link as a link", () => {
  const doc = [
    "intro",
    "see [text] here",
    "# head [text] end",
    "**bold [text] bold**",
    "[a](https://x.y)",
    // The blank line keeps the lines above out of the setext heading's paragraph.
    "",
    "Setext [text] st",
    "===",
  ];
  const parent = document.body.appendChild(document.createElement("div"));
  view = new EditorView({
    state: EditorState.create({
      doc: doc.join("\n"),
      selection: { anchor: 0 },
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
  const lines = view.contentDOM.querySelectorAll(".cm-line");

  for (const [n, word] of [
    [1, "see"],
    [2, "head"],
    [3, "bold"],
    [6, "Setext"],
  ] as const) {
    const line = lines[n] as Element;
    expect(line.textContent).toContain("[text]");
    expect(look(painting(line, "text")), line.textContent ?? "").toEqual(
      look(painting(line, word)),
    );
  }
  const link = look(painting(lines[4] as Element, "a"));
  expect(link.line).toBe("underline");
  expect(link.color).not.toBe(look(painting(lines[1] as Element, "see")).color);
});
