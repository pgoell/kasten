/**
 * The editor paints its cursor and selection from the tokens, so a theme
 * switch at runtime reaches them. jsdom computes no colours, so this reads
 * the cascade in a real browser, with the vim block cursor on and off.
 */

import { openSearchPanel, search } from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { basicSetup } from "codemirror";
import { kastenTheme } from "@/lib/editor-theme";
import { vimModeState } from "@/lib/vim-mode";
import "@/styles/app.css";

let view: EditorView | undefined;

afterEach(() => {
  view?.dom.parentElement?.remove();
  view?.destroy();
  view = undefined;
  document.documentElement.removeAttribute("data-theme");
});

function mount(vimOn: boolean, extra: Extension = []): EditorView {
  const parent = document.body.appendChild(document.createElement("div"));
  view = new EditorView({
    state: EditorState.create({
      doc: "one two three",
      selection: { anchor: 0, head: 3 },
      // As the note editor mounts them: vim ahead of basicSetup, which draws the cursor and selection.
      extensions: [vimOn ? [vim(), vimModeState()] : [], basicSetup, kastenTheme, extra],
    }),
    parent,
  });
  view.focus();
  return view;
}

/** The element a selector finds once the editor has measured and drawn it. */
async function drawn(editor: EditorView, selector: string): Promise<Element> {
  await vi.waitFor(() => expect(editor.dom.querySelector(selector)).not.toBeNull());
  return editor.dom.querySelector(selector) as Element;
}

async function read(dark: boolean) {
  if (dark) document.documentElement.setAttribute("data-theme", "dark");

  const plain = mount(false);
  const background = getComputedStyle(plain.dom).backgroundColor;
  const cursor = getComputedStyle(await drawn(plain, ".cm-cursor")).borderLeftColor;
  const selection = getComputedStyle(await drawn(plain, ".cm-selectionBackground")).backgroundColor;
  plain.dom.parentElement?.remove();
  plain.destroy();

  const vimmed = mount(true);
  const fatCursor = getComputedStyle(await drawn(vimmed, ".cm-fat-cursor")).backgroundColor;

  return { background, cursor, selection, fatCursor };
}

it("the cursor and the selection read the tokens in light and dark, vim on and off", async () => {
  const result = { light: await read(false), dark: await read(true) };
  expect(result).toEqual({
    light: {
      background: "rgb(246, 246, 244)",
      cursor: "rgb(49, 111, 144)",
      selection: "rgba(249, 157, 27, 0.22)",
      fatCursor: "rgb(49, 111, 144)",
    },
    dark: {
      background: "rgb(20, 20, 20)",
      cursor: "rgb(130, 185, 217)",
      selection: "rgba(167, 212, 228, 0.18)",
      fatCursor: "rgb(130, 185, 217)",
    },
  });
});

it("the search panel reads the tokens in dark", async () => {
  document.documentElement.setAttribute("data-theme", "dark");
  const editor = mount(false, search());
  openSearchPanel(editor);
  const field = getComputedStyle(await drawn(editor, ".cm-panel.cm-search .cm-textfield"));
  const button = getComputedStyle(await drawn(editor, ".cm-panel.cm-search .cm-button"));
  expect({
    textfield: { background: field.backgroundColor, color: field.color },
    button: {
      background: button.backgroundColor,
      color: button.color,
      image: button.backgroundImage,
    },
  }).toEqual({
    textfield: { background: "rgb(35, 35, 35)", color: "rgb(232, 231, 228)" },
    button: { background: "rgb(35, 35, 35)", color: "rgb(232, 231, 228)", image: "none" },
  });
});
