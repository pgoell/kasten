import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, Facet, type Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { type CM5EditorInterface, Vim } from "@replit/codemirror-vim";
import { highlightAt, mayBeHighlightLine } from "@/lib/highlight";
import {
  type FileLink,
  fileLinkAt,
  resolveFrom,
  type UrlLink,
  urlLinkAt,
} from "@/lib/link-reference";
import { noteSectionOf } from "@/lib/note-section";
import { NOTE, repeats, watchPresses } from "@/lib/presses";
import { notePath } from "@/lib/todo/todo-commands";
import { splitTarget, wikiLinkAt } from "@/lib/wikilink";

/**
 * A file a markdown link names, its path decoded and its `#` part as written.
 * Passed beside the target so the route opens it at the anchor or page, without parsing the name again.
 */
export interface FileTarget {
  path: string;
  heading: string | null;
}

/** The target is the note's name, or the file's path when `file` is given. */
type FollowHandler = (target: string, file?: FileTarget) => void;
type HighlightHandler = (quote: string[]) => void;

/**
 * Carries the follow callback. A facet, not an `editorCommands` entry: that table names
 * no arguments, and `gf` carries the note's name.
 */
export const followHandler = Facet.define<FollowHandler, FollowHandler | undefined>({
  combine: (handlers) => handlers[0],
});

/**
 * Carries the highlight callback. A second facet, since a highlight names a passage in a book,
 * not a note's path.
 */
export const highlightHandler = Facet.define<HighlightHandler, HighlightHandler | undefined>({
  combine: (handlers) => handlers[0],
});

/**
 * Follows `[[target]]` to the route, or `[[#heading]]` within this note. The heading is found in
 * the text on screen, since the query cache holds only the last save.
 */
function followLink(view: EditorView, target: string) {
  const { name, heading } = splitTarget(target);
  if (name !== "") {
    view.state.facet(followHandler)?.(target);
    return;
  }
  const { doc } = view.state;
  const section = heading === null ? null : noteSectionOf(doc.toString(), heading);
  if (section === null) return;
  const { from } = doc.line(section.line);
  view.dispatch({
    selection: { anchor: from },
    effects: EditorView.scrollIntoView(from, { y: "center" }),
  });
}

/**
 * Opens the file a markdown link names, relative to this note's folder.
 * A note with no path, or an address climbing above the vault, follows nothing.
 */
function followFile(view: EditorView, file: FileLink): void {
  const note = view.state.facet(notePath);
  const path = note === undefined ? null : resolveFrom(note, file.path);
  if (path === null) return;
  view.state.facet(followHandler)?.(path, { path, heading: file.heading });
}

/**
 * The quote of the highlight block `at` sits in, or null. Reads only the lines around `at`,
 * since the whole note would be copied on every Enter off a link (#638).
 */
function highlightNear(doc: Text, at: number): string[] | null {
  if (!mayBeHighlightLine(doc.line(at).text)) return null;
  let first = at;
  while (first > 1 && mayBeHighlightLine(doc.line(first - 1).text)) first -= 1;
  let last = at;
  while (last < doc.lines && mayBeHighlightLine(doc.line(last + 1).text)) last += 1;
  return highlightAt(doc.sliceString(doc.line(first).from, doc.line(last).to), at - first + 1);
}

/**
 * Opens what the cursor's line names, vim's go-to-file. A `[[link]]` wins, even in a quote;
 * then a highlight block. Otherwise false, so `<CR>` still moves down.
 */
export function follow(view: EditorView): boolean {
  const { doc, selection } = view.state;
  const target = wikiLinkAt(view.state, selection.main.head);
  if (target !== null) {
    followLink(view, target);
    return true;
  }

  // A file link is read before the highlight, which a `[H](x/a%5D%5Db.html#s1)`
  // chapter line sits in too: gf on it opens the file, not the passage.
  const tree = syntaxTree(view.state);
  const file =
    fileLinkAt(tree.resolveInner(selection.main.head, 1), doc) ??
    fileLinkAt(tree.resolveInner(selection.main.head, -1), doc);
  if (file !== null) {
    followFile(view, file);
    return true;
  }

  const quote = highlightNear(doc, doc.lineAt(view.state.selection.main.head).number);
  if (quote === null) return false;
  // True whether or not a handler is installed, which is what the wikilink
  // branch above does: the only editor with no callback is the empty pane, and
  // that holds no note.
  view.state.facet(highlightHandler)?.(quote);
  return true;
}

Vim.defineAction("kastenFollowLink", (cm: { cm6: EditorView }) => follow(cm.cm6));
Vim.mapCommand("gf", "action", "kastenFollowLink", {}, { context: "normal" });

/**
 * Enter follows the link and moves the way vim does. The mapping takes the key whether or not
 * it acted, so a line with no link hands `<CR>` back to vim's `j^`.
 */
Vim.defineAction("kastenFollowLinkOrDown", (cm: CM5EditorInterface) => {
  if (follow(cm.cm6)) return;
  Vim.handleKey(cm, "j", "user");
  Vim.handleKey(cm, "^", "user");
});
Vim.mapCommand("<CR>", "action", "kastenFollowLinkOrDown", {}, { context: "normal" });

/**
 * Ctrl+click or cmd+click follows the rendered link, as a browser does. A double-click follows
 * on its first press (#569); a press is a repeat only when the one before followed the same link (#572).
 */
export function followOnClick(): Extension {
  watchPresses();
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!event.ctrlKey && !event.metaKey) return false;
      const target = linkUnder(event, view);
      if (target !== null) {
        // Returning true makes CodeMirror cancel the mousedown, and with it the
        // focus the browser would have moved here. The pane a link opens off is
        // the focused one, so a click in another pane takes the focus first, the
        // way Obsidian splits off the pane you clicked (#361). The focus event
        // runs inside this call, so the layout hears of it before the open.
        if (!repeats(event, NOTE)) {
          view.focus();
          followLink(view, target);
        }
        return true;
      }
      const file = fileUnder(event, view);
      if (file !== null) {
        if (!repeats(event, NOTE)) {
          view.focus();
          followFile(view, file);
        }
        return true;
      }
      const link = urlUnder(event, view);
      if (link === null) return false;
      if (!repeats(event, link.address)) window.open(link.address, "_blank", "noopener");
      return true;
    },
  });
}

/** The `[[link]]` around `pos`, looking one way only. */
function wikiLinkNode(state: EditorState, pos: number, side: -1 | 1): SyntaxNode | null {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side);
  for (; node; node = node.parent) if (node.name === "WikiLink") return node;
  return null;
}

/**
 * The rendered `[text](url)` or reference link under the pointer, if it opens in a tab.
 * None in a drawn table: `posAtDOM` answers the block's start there, another cell's link (#565).
 */
function urlUnder(event: Event, view: EditorView): UrlLink | null {
  const node = linkNodeUnder(event, view);
  return node === null ? null : urlLinkAt(node, view.state.doc);
}

/** The markdown link under the pointer that names a vault file, if it does. */
function fileUnder(event: Event, view: EditorView): FileLink | null {
  const node = linkNodeUnder(event, view);
  return node === null ? null : fileLinkAt(node, view.state.doc);
}

/** The node of the rendered `[text](url)` under the pointer, or null off a drawn link. */
function linkNodeUnder(event: Event, view: EditorView): SyntaxNode | null {
  const element = event.target instanceof HTMLElement ? event.target.closest(".cm-link") : null;
  if (element === null || element.closest(".cm-table-block") !== null) return null;
  return syntaxTree(view.state).resolveInner(view.posAtDOM(element), 1);
}

/**
 * The nearest link span under the pointer, or null. Not the target: a mark inside a link nests
 * its own span (#432), and in a drawn table the span carries the target.
 */
function linkUnder(event: Event, view: EditorView): string | null {
  const element =
    event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(".cm-wikilink") : null;
  if (element === null) return null;
  if (element.closest(".cm-table-block") !== null) return element.dataset.target ?? null;
  return wikiLinkAt(view.state, view.posAtDOM(element));
}

/**
 * Where the rendered `[[link]]` under the pointer starts and ends, off a drawn table.
 * Looks forwards only, past the hidden `[[` or the alias bar, so the position is inside the link.
 */
function wikiLinkRangeUnder(event: Event, view: EditorView): SyntaxNode | null {
  const element = event.target instanceof HTMLElement ? event.target.closest(".cm-wikilink") : null;
  if (element === null) return null;
  return wikiLinkNode(view.state, view.posAtDOM(element), 1);
}

/**
 * A tap follows a link. It is read on touch-down, because a drag from a link is a scroll, and acted on
 * at the click. A link the cursor is already in is edited, not followed.
 */
export function followOnTap(): Extension {
  let landed: string | null = null;
  let landedUrl: string | null = null;
  let landedFile: FileLink | null = null;
  watchPresses();
  return EditorView.domEventHandlers({
    pointerdown(event, view) {
      const touch = event.pointerType === "touch";
      const head = view.state.selection.main.head;
      const target = touch ? linkUnder(event, view) : null;
      // The cursor is never in a link a drawn table shows, the table showing
      // its source while it is, so one of the same name elsewhere is not it.
      const drawn =
        event.target instanceof Element && event.target.closest(".cm-table-block") !== null;
      // The link the cursor is in by its place, not its name: another link to
      // the same note is not the one being edited (#568). Both ends count, as
      // in `wikiLinkAt`, which is where `$` lands on a line ending in a link.
      // Between `[[a]][[b]]` the cursor touches both, and it is in the one
      // `wikiLinkAt` would read, forwards first.
      const range = target === null || drawn ? null : wikiLinkRangeUnder(event, view);
      const here = wikiLinkNode(view.state, head, 1) ?? wikiLinkNode(view.state, head, -1);
      const editing = range !== null && here !== null && here.from === range.from;
      landed = editing ? null : target;
      const link = touch ? urlUnder(event, view) : null;
      landedUrl = link !== null && (head < link.from || head > link.to) ? link.address : null;
      // A file link is one the tap opens in kasten, so it is not the address a
      // tap would window.open, and it reads the same way the link does.
      const file = touch ? fileUnder(event, view) : null;
      landedFile = file !== null && (head < file.from || head > file.to) ? file : null;
      return false;
    },
    // The browser takes the finger for a scroll. No click follows one, but
    // nothing should be left waiting for the next click either.
    pointercancel() {
      landed = null;
      landedUrl = null;
      landedFile = null;
      return false;
    },
    click(event, view) {
      const note = landed;
      const file = landedFile;
      const url = landedUrl;
      landed = null;
      landedUrl = null;
      landedFile = null;
      const key = note !== null || file !== null ? NOTE : url;
      if (key === null) return false;
      // A double tap's second click is kept and does nothing (#569). Off a
      // table the first tap has put the cursor in the link, which turns the
      // second away too; in a drawn table the cursor never moves in. Chrome
      // counts any tap close to the one before as its second, so the click is
      // a repeat only when the tap before it followed the same (#572).
      if (repeats(event, key)) return true;
      if (note !== null) followLink(view, note);
      else if (file !== null) followFile(view, file);
      else if (url !== null) window.open(url, "_blank", "noopener");
      return true;
    },
  });
}
