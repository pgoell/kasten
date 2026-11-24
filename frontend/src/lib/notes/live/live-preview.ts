import { forceParsing, syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import {
  EditorState,
  type Extension,
  type Line,
  RangeSet,
  StateField,
  type Transaction,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";
import { setVimMode, vimKeys, vimModeField, vimModeState } from "@/lib/notes/editor/vim-mode";
import { embedSource } from "@/lib/notes/embeds/embed";
import { imagePaths } from "@/lib/notes/embeds/image";
import { vaultPaths } from "@/lib/notes/links/wikilink";
import {
  Callouts,
  foldClicks,
  folds,
  opensFor,
  toggleFold,
} from "@/lib/notes/live/live-preview-callouts";
import { drawEmbed } from "@/lib/notes/live/live-preview-embeds";
import { drawFence, retheme, rethemes } from "@/lib/notes/live/live-preview-fences";
import {
  isLineRevealed,
  isNodeRevealed,
  nudgeOutOfHidden,
  type Span,
  touchedSpans,
  Walk,
} from "@/lib/notes/live/live-preview-hidden";
import { drawImage } from "@/lib/notes/live/live-preview-images";
import {
  drawInline,
  drawLink,
  drawRuby,
  INLINE,
  type Inline,
  markRelation,
} from "@/lib/notes/live/live-preview-inline";
import { isProgress, Lists, movesCounts } from "@/lib/notes/live/live-preview-lists";
import { drawBlockMath, drawInlineMath } from "@/lib/notes/live/live-preview-math";
import { drawSvg } from "@/lib/notes/live/live-preview-svg";
import { drawTable } from "@/lib/notes/live/live-preview-tables";
import { drawTime, linkedVideos } from "@/lib/notes/live/live-preview-times";
import { videoLayer } from "@/lib/notes/live/live-preview-video";
import { watchPresses } from "@/lib/ui/input/presses";

const HEADING = /^ATXHeading([1-6])$/;

/**
 * What the editor shows, and which parts of the document it hides.
 * The selection filter needs the hidden ranges, and a filter can only read state.
 */
interface Live {
  decorations: DecorationSet;
  hidden: RangeSet<Decoration>;
  /** What constructs showing their source reach across blocks, never drawn. */
  wide: RangeSet<Decoration>;
  /** Whether this is what a whole walk over the finished tree draws, so the parse catching up changes nothing. */
  whole: boolean;
  /** Whether a todo is indented, so a patch draws the parents' counts from the whole note. */
  nested: boolean;
}

/** The nodes drawn by their line that no flag of their own picks out. */
const LINE_NODES = new Set([
  "Escape",
  "Embed",
  "Link",
  "QuoteMark",
  "HorizontalRule",
  "Image",
  "InlineMath",
]);

/** One walk over the spans of the note, or over all of it. */
function walkOver(state: EditorState, spans: readonly Span[] | null): { walk: Walk; lists: Lists } {
  const walk = new Walk(state);
  const callouts = new Callouts();
  const lists = new Lists();
  // One read of the note's videos for the whole walk, shared by every stamp.
  const linked = linkedVideos(state);
  const visit = (from?: number, to?: number) =>
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        // Inside a table the widget has already drawn: nothing there is on the
        // screen to decorate.
        if (node.to <= walk.drawn) return false;
        if (callouts.covers(node.from, node.to)) return false;
        return enterBlock(walk, callouts, lists, linked, node);
      },
    });
  if (spans === null) visit();
  else for (const [from, to] of spans) visit(from, to);
  callouts.finish(walk);
  return { walk, lists };
}

function build(state: EditorState): Live {
  const { walk, lists } = walkOver(state, null);
  lists.finish(walk);
  return {
    decorations: Decoration.set(walk.decorations, true),
    hidden: Decoration.set(walk.hidden, true),
    wide: Decoration.set(walk.wide, true),
    whole: syntaxTreeAvailable(state, state.doc.length),
    nested: lists.nested,
  };
}

/**
 * The drawing after an edit or a cursor move: the old one mapped, with only the blocks it touched walked again, so a
 * key in a long note costs what it costs in a short one (#2331). Null where only a whole walk is sure to be right.
 */
function patch(value: Live, tr: Transaction): Live | null {
  const decorations = value.decorations.map(tr.changes);
  const wide = value.wide.map(tr.changes);
  const spans = touchedSpans(tr, ([from, to]) => {
    let low = from;
    let high = to;
    const reach = (start: number, end: number) => {
      low = Math.min(low, start);
      high = Math.max(high, end);
    };
    decorations.between(from, to, reach);
    wide.between(from, to, reach);
    return [low, high];
  });
  if (spans === null) return null;
  const { walk, lists } = walkOver(tr.state, spans);
  const inside = (from: number, to: number) => spans.some(([a, b]) => from >= a && to <= b);
  // A drawing that reaches past its block, as an svg over blank lines can, is left to a whole walk.
  if (![...walk.decorations, ...walk.wide].every((range) => inside(range.from, range.to)))
    return null;
  const nested = value.nested || lists.nested;
  // The counts read the whole note, so they are drawn again only when the edit can move them.
  const recount = nested && (!value.nested || movesCounts(tr));
  if (recount) lists.finish(walk, true);
  const outside = (from: number, to: number) => spans.every(([a, b]) => to < a || from > b);
  const reach = recount ? {} : { filterFrom: spans[0]?.[0], filterTo: spans.at(-1)?.[1] };
  return {
    decorations: decorations.update({
      ...reach,
      filter: (from, to, decoration) => (isProgress(decoration) ? !recount : outside(from, to)),
      add: walk.decorations,
      sort: true,
    }),
    hidden: value.hidden.map(tr.changes).update({
      filterFrom: spans[0]?.[0],
      filterTo: spans.at(-1)?.[1],
      filter: outside,
      add: walk.hidden,
      sort: true,
    }),
    wide: wide.update({
      filter: outside,
      filterFrom: spans[0]?.[0],
      filterTo: spans.at(-1)?.[1],
      add: walk.wide,
      sort: true,
    }),
    // Past a parse still running the drawing stays the whole walk's, as before; the parse's next step walks again.
    whole: value.whole,
    nested,
  };
}

/** One node of the walk. `false` keeps the walk out of its children. */
function enterBlock(
  walk: Walk,
  callouts: Callouts,
  lists: Lists,
  linked: () => string[],
  node: SyntaxNodeRef,
): false | undefined {
  switch (node.name) {
    case "Blockquote":
      callouts.enter(walk, node.node);
      return;
    // Coloured and left where it is, like the overdue red below: the hash is
    // part of the tag rather than a mark standing in front of one, so there
    // is nothing here for a revealed line to bring back.
    case "Tag":
      walk.decorations.push(Decoration.mark({ class: "cm-tag" }).range(node.from, node.to));
      return;
    case "FencedCode":
      return drawFence(walk, node.node);
    // A paragraph that is not an svg has nothing of its own to decorate, so it
    // is left to its children as it was before this check.
    case "HTMLBlock":
    case "CommentBlock":
    case "ProcessingInstructionBlock":
      return drawSvg(walk, node.node);
    case "Paragraph":
      lists.letters(walk, node.node);
      return drawSvg(walk, node.node);
    case "Table":
      drawTable(walk, node.node);
      return;
    case "BlockMath":
      return drawBlockMath(walk, node.node);
  }
  return enterLine(walk, callouts, lists, linked, node);
}

function enterLine(
  walk: Walk,
  callouts: Callouts,
  lists: Lists,
  linked: () => string[],
  node: SyntaxNodeRef,
): false | undefined {
  const { state } = walk;
  const heading = HEADING.exec(node.name);
  const inline = INLINE[node.name];
  const isMark = node.name === "ListMark";
  const isRuby = node.name === "HTMLTag" && state.doc.sliceString(node.from, node.to) === "<ruby>";
  if (!heading && !inline && !isMark && !isRuby && !LINE_NODES.has(node.name)) return;

  const line = state.doc.lineAt(node.from);
  const revealed = isLineRevealed(state, line) || node.from < walk.tableEnd;

  switch (node.name) {
    // `\*` is the asterisk, and the backslash is a mark like any other. An
    // Anki card side opening with a fence is written with a backslash before
    // its backticks so it opens none, and should read as the backticks. By
    // the line rule, so the cursor's line and a table's source keep it.
    case "Escape":
      if (!revealed) walk.hide(node.from, node.from + 1);
      return;
    case "Embed":
      drawEmbed(walk, node.node, revealed, renderedMarkdown);
      return false;
    case "HorizontalRule":
      drawRule(walk, line, revealed);
      return;
    // Left for after the walk, when the callouts around the line are known.
    case "QuoteMark":
      callouts.quote(node.from, node.to, line, revealed);
      return;
    case "Image":
      drawImage(walk, node.node, revealed);
      return;
  }

  if (heading) {
    drawHeading(walk, node.node, heading, line, revealed);
    return;
  }
  // The dot is drawn in CSS, so it has to go the moment the `-` it stands
  // in for comes back, or the line carries two bullets.
  if (isMark) {
    lists.item(walk, node.node, line, revealed);
    return;
  }
  if (isRuby) {
    drawRuby(walk, node.from, line, revealed);
    return;
  }
  return enterInline(walk, linked, node, inline, line, revealed);
}

/**
 * The line is drawn, so the dashes asking for it go. Like the bullet and
 * unlike the blockquote's bar, the drawing stands in for characters, so
 * it leaves when they come back. `---` under a paragraph is a setext
 * heading rather than a rule, and the parser has already told them apart.
 */
function drawRule(walk: Walk, line: Line, revealed: boolean): void {
  if (revealed) return;
  walk.decorations.push(Decoration.line({ class: "cm-rule" }).range(line.from));
  walk.hide(line.from, line.to);
}

function drawHeading(
  walk: Walk,
  node: SyntaxNode,
  heading: RegExpExecArray,
  line: Line,
  revealed: boolean,
): void {
  // The size stays put while the marks come and go, so revealing a line
  // does not make it jump.
  walk.decorations.push(Decoration.line({ class: `cm-heading-${heading[1]}` }).range(line.from));
  if (revealed) return;

  const mark = node.firstChild;
  if (mark?.name !== "HeaderMark") return;
  walk.hideLeader(mark.from, mark.to, line);
}

/**
 * A link and the inline constructs below it are read off the node: the
 * cursor has to be in the one whose marks come back. Everything above is
 * a line construct, whose mark sits at the head of the line and whose two
 * rules therefore say the same thing.
 */
function enterInline(
  walk: Walk,
  linked: () => string[],
  node: SyntaxNodeRef,
  inline: Inline | undefined,
  line: Line,
  revealed: boolean,
): false | undefined {
  const inlineRevealed =
    isNodeRevealed(walk.state, node.from, node.to) || node.from < walk.tableEnd;

  if (node.name === "InlineMath") {
    drawInlineMath(walk, node.from, node.to, inlineRevealed);
    return false;
  }

  if (node.name === "Link") {
    // Ahead of the link, which would otherwise colour and hide the time
    // and leave a take's address a link to open.
    if (drawTime(walk, node.node, revealed, linked)) return;
    drawLink(walk, node.node, line, inlineRevealed);
    return;
  }

  if (node.name === "WikiLink") markRelation(walk, node.from, line);

  if (!inline) return;
  drawInline(walk, node.node, inline, inlineRevealed);
}

/**
 * How far the parse has got. The tree's own length can run past it, so this
 * asks CodeMirror, by halves, up to where a full tree is available.
 */
function parsedTo(state: EditorState): number {
  let low = 0;
  let high = state.doc.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (syntaxTreeAvailable(state, mid)) low = mid;
    else high = mid - 1;
  }
  return low;
}

/**
 * Where an edit's parse ran out of its 20ms (#1005), the tree stops short.
 * The old drawing holds there until the parse lands, so an embed does not lose its box and remount.
 */
function keepPastParse(value: Live, tr: Transaction, fresh: Live): Live {
  const { doc, selection } = tr.state;
  const reach = parsedTo(tr.state);
  if (syntaxTreeAvailable(tr.state) || reach >= doc.length) return fresh;
  const kept = { whole: false, nested: fresh.nested, wide: fresh.wide };
  const keep = (from: number, to: number) => {
    if (from < reach) return false;
    const onLines = (start: number, end: number) =>
      doc.lineAt(start).from <= to && doc.lineAt(end).to >= from;
    let touched = false;
    tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
      if (onLines(fromB, toB)) touched = true;
    });
    return !touched && !selection.ranges.some((range) => onLines(range.from, range.to));
  };
  // One source per range: a stopped tree can hold nodes past the reach, so the fresh drawing
  // may hold what the old one keeps, and joined, each rebuild nests another mark (#2227).
  const both = <T extends Decoration>(now: RangeSet<T>, before: RangeSet<T>) =>
    RangeSet.join([
      now.update({ filter: (from, to) => !keep(from, to) }),
      (tr.docChanged ? before.map(tr.changes) : before).update({ filter: keep }),
    ]);
  return {
    ...kept,
    decorations: both(fresh.decorations, value.decorations),
    hidden: both(fresh.hidden, value.hidden),
  };
}

const live = StateField.define<Live>({
  create: build,
  update(value, tr) {
    // Turning vim off or on arrives by reconfiguration, the way the listing
    // below does, and changes which line shows its source as a mode change does.
    const modeChanged =
      tr.effects.some((effect) => effect.is(setVimMode)) ||
      tr.startState.facet(vimKeys) !== tr.state.facet(vimKeys);
    // The listing arrives by reconfiguration rather than by effect, so there is
    // nothing in `tr.effects` to read it off. A note holding a link to a note
    // that has just been written has to stop calling it dead. The image listing
    // and the embed source come the same way, and decide what an embed draws.
    const vaultChanged =
      tr.startState.facet(vaultPaths) !== tr.state.facet(vaultPaths) ||
      tr.startState.facet(imagePaths) !== tr.state.facet(imagePaths) ||
      tr.startState.facet(embedSource) !== tr.state.facet(embedSource) ||
      tr.startState.facet(opensFor) !== tr.state.facet(opensFor) ||
      tr.startState.readOnly !== tr.state.readOnly;
    // A long note is parsed in slices off the main thread's idle time, each
    // slice landing as a transaction that changes nothing else. Without this
    // the text past the first slice stays raw until the cursor moves.
    const parsed = syntaxTree(tr.startState) !== syntaxTree(tr.state);
    const flipped = tr.effects.some((effect) => effect.is(toggleFold));
    // A diagram is drawn in the theme it was built in, so a switch builds it again.
    const rethemed = tr.effects.some((effect) => effect.is(retheme));
    const global = modeChanged || vaultChanged || flipped || rethemed;
    const edited = tr.docChanged || tr.selection !== undefined;
    if (!edited && !global && !parsed) return value;
    if (!global) {
      // A drawing a patch made already holds what the parse catching up would bring.
      if (!edited && value.whole) return value;
      const patched = edited ? patch(value, tr) : null;
      if (patched) return patched;
    }
    return keepPastParse(value, tr, build(tr.state));
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

/**
 * Keeps the cursor out of the hidden marks.
 * Reads the state before the transaction, since `tr.state` is computed inside the filter that makes it.
 */
const nudgeSelection = EditorState.transactionFilter.of((tr) => {
  // Leaving insert mode hides the marks the cursor may sit in, with no selection to nudge.
  // Read the hidden marks off the new state; the old one still shows them.
  if (!tr.selection && tr.effects.some((effect) => effect.is(setVimMode))) {
    const { selection } = tr.startState;
    const nudged = nudgeOutOfHidden(selection, selection, tr.state.field(live).hidden, tr.newDoc);
    return nudged ? [tr, { selection: nudged }] : tr;
  }
  if (!tr.selection) return tr;

  const hidden = tr.startState.field(live).hidden.map(tr.changes);
  const nudged = nudgeOutOfHidden(tr.selection, tr.startState.selection, hidden, tr.newDoc);
  return nudged ? [tr, { selection: nudged }] : tr;
});

/** Room for a parse before a paint on a slow phone; a screen of markdown takes a few ms on a desktop. */
export const PAINT_PARSE_MS = 200;

/**
 * Parses to the end of what a view shows before the paint, as it opens, scrolls, jumps or has its text replaced.
 * CodeMirror's own parse stops after 20 ms and leaves the rest to an idle pass (#2323, #2324).
 * Not for typing that keeps the screen: up to 200 ms a key on a slow phone (#2327).
 */
const parseShownPart = ViewPlugin.fromClass(
  class {
    private readonly view: EditorView;
    private queued = false;
    private gone = false;
    private shown: { from: number; to: number };

    constructor(view: EditorView) {
      this.view = view;
      this.shown = view.viewport;
      this.queue();
    }

    update(update: ViewUpdate) {
      const before = this.shown;
      this.shown = update.view.viewport;
      if (!update.viewportChanged && !update.docChanged) return;
      // A key moves the screen's end by what it typed; only a scroll or a jump moves it further.
      const kept =
        update.changes.mapPos(before.from, -1) === this.shown.from &&
        update.changes.mapPos(before.to, 1) === this.shown.to;
      if (!kept || !typed(update)) this.queue();
    }

    destroy() {
      this.gone = true;
    }

    private parsed(): boolean {
      return syntaxTreeAvailable(this.view.state, this.view.viewport.to);
    }

    private queue() {
      if (this.queued || this.parsed()) return;
      this.queued = true;
      // A microtask: a dispatch inside an update throws, and microtasks still run before the paint.
      queueMicrotask(() => {
        this.queued = false;
        if (this.gone || this.parsed()) return;
        forceParsing(this.view, this.view.viewport.to, PAINT_PARSE_MS);
      });
    }
  },
);

/** An edit the user typed or deleted, which leaves the rest of the note as it was. */
function typed(update: ViewUpdate): boolean {
  return update.transactions.every(
    (tr) => !tr.docChanged || tr.isUserEvent("input") || tr.isUserEvent("delete"),
  );
}

export function livePreview(): Extension {
  // The picture's and the table's follows read the presses too, and a view
  // may be mounted without the editor that would watch them.
  watchPresses();
  return [
    vimModeState(),
    folds,
    live,
    foldClicks,
    nudgeSelection,
    rethemes,
    videoLayer,
    parseShownPart,
  ];
}

/**
 * The rendering on its own, for a view with no vim and no cursor.
 * Keeps `vimModeField` and `folds`, which `live` reads; the default reveals nothing.
 */
export function renderedMarkdown(): Extension {
  // For the reason `livePreview` watches them: a preview may be the only view.
  watchPresses();
  return [vimModeField, folds, live, foldClicks, rethemes, videoLayer, parseShownPart];
}
