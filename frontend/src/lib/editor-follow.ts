import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, Facet, type Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { type CM5EditorInterface, Vim } from "@replit/codemirror-vim";
import { highlightAt, mayBeHighlightLine } from "@/lib/highlight";
import { type FileLink, fileLinkAt, type UrlLink, urlLinkAt } from "@/lib/link-reference";
import { noteSectionOf } from "@/lib/note-section";
import { NOTE, repeats, watchPresses } from "@/lib/presses";
import { splitTarget, wikiLinkAt } from "@/lib/wikilink";

/**
 * A file a markdown link names, its path decoded and its `#` part as written.
 *
 * Passed beside the target so the route opens a page or pdf the way a
 * wikilink to it does, at the anchor or page, without parsing the name again.
 */
export interface FileTarget {
  path: string;
  heading: string | null;
}

/** The target is the note's name, or the file's path when `file` is given. */
type FollowHandler = (target: string, file?: FileTarget) => void;
type HighlightHandler = (quote: string[]) => void;

/**
 * Carries the follow callback, for the reason `saveHandler` carries the other.
 *
 * A facet and not one of `editorCommands`: that table is the one a leader
 * sequence names a command in, and this command is reached by `gf` and carries
 * a note's name with it.
 */
export const followHandler = Facet.define<FollowHandler, FollowHandler | undefined>({
  combine: (handlers) => handlers[0],
});

/**
 * Carries the highlight callback, for the reason `saveHandler` carries the other.
 *
 * A second facet rather than a second meaning on the first: what a highlight
 * names is a passage in a book and not a note's path, so the two callbacks
 * carry different things.
 */
export const highlightHandler = Facet.define<HighlightHandler, HighlightHandler | undefined>({
  combine: (handlers) => handlers[0],
});

/**
 * Follow `[[target]]`: to the route, or for `[[#heading]]` within this note.
 *
 * A heading of the note on screen is found in the text on screen. The vault
 * and the query cache hold the last save, and the line typed since moves the
 * heading the link means.
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

/** Open the file a markdown link names, the way a wikilink to it opens. */
function followFile(view: EditorView, file: FileLink): void {
  view.state.facet(followHandler)?.(file.path, { path: file.path, heading: file.heading });
}

/**
 * The quote of the highlight block line `at` sits in, or null outside one.
 *
 * Read from the run of lines around `at` that could belong to a block and not
 * from the whole note, which Enter off a link would otherwise copy on every
 * press (#638). A prose line reads nothing past itself.
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
 * Open what the cursor's line names, vim's own go-to-file.
 *
 * Two readers, in this order. A `[[link]]` under the cursor is a link even
 * inside a quote line, and a highlight block is the second meaning `gf` gains:
 * the block names a passage in a book, and the cursor may sit on any of its
 * lines. Neither, and this answers false the way it always did, which is what
 * keeps `<CR>` moving down.
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
 * Enter follows the link too, and moves the way vim moves off one.
 *
 * A mapping takes the key whether or not the action did anything, and vim
 * reads a bare `<CR>` as `j^`, so a line holding no link would lose the motion
 * to a key that did nothing. Handing those two keys back is what keeps it.
 */
Vim.defineAction("kastenFollowLinkOrDown", (cm: CM5EditorInterface) => {
  if (follow(cm.cm6)) return;
  Vim.handleKey(cm, "j", "user");
  Vim.handleKey(cm, "^", "user");
});
Vim.mapCommand("<CR>", "action", "kastenFollowLinkOrDown", {}, { context: "normal" });

/**
 * Ctrl+click, or cmd+click, follows a link the way every browser opens one.
 *
 * The element decides, not the coordinates: the rendered link is a span of its
 * own, so a click that landed on it is a click on the link, and one that landed
 * in the space after the line is not. `posAtDOM` needs no layout for that,
 * which a test in jsdom also needs. The plain click is left alone, because
 * putting the cursor in a link is how the link gets edited.
 *
 * A markdown link to an address opens it in a new tab, so the note stays open
 * behind it.
 *
 * A double-click follows once, on its first press (#569). The second is still
 * kept from CodeMirror, which would select a word in the link and put the
 * cursor there. The browser counts any press close to the one before as its
 * second, so a press is a repeat only when the press before it followed the
 * same (#572).
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
 *
 * None in a drawn table: `posAtDOM` there answers the block's start, which is
 * another cell's link (#565), and the block opens a cell's address itself.
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
 * The note the rendered link under the pointer names, or null off one.
 *
 * The nearest link span, not the target itself: inside bold or another mark
 * the text sits in a span of its own nested in the link's (#432). In a drawn
 * table the span carries its target, `posAtDOM` answering the block's start.
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
 *
 * Looking forwards only: the span starts past the hidden `[[`, or past the
 * alias bar, so the position is always inside the link.
 */
function wikiLinkRangeUnder(event: Event, view: EditorView): SyntaxNode | null {
  const element = event.target instanceof HTMLElement ? event.target.closest(".cm-wikilink") : null;
  if (element === null) return null;
  return wikiLinkNode(view.state, view.posAtDOM(element), 1);
}

/**
 * A tap follows a link, a finger having no ctrl to hold.
 *
 * Read on the way down and acted on at the click, because the two halves are
 * known at different moments. A finger that lands on a link and drags is
 * scrolling, and only the click says it did not. By the click the browser has
 * put the cursor in the link, which shows its brackets and redraws it, so what
 * the finger landed on has to be read before that.
 *
 * A link the cursor is already in is one being edited, and a tap in it moves
 * the cursor as a tap anywhere else does. The way into a link is from beside
 * it. A markdown link to an address opens in a new tab, as on ctrl+click. A
 * double tap follows once, as a double-click does.
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
