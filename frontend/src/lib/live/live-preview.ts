import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import {
  EditorState,
  type Extension,
  RangeSet,
  StateField,
  type Transaction,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { setVimMode, vimKeys, vimModeField, vimModeState } from "@/lib/editor/vim-mode";
import { embedSource } from "@/lib/embed";
import { imagePaths } from "@/lib/image";
import { Callouts, foldClicks, folds, toggleFold } from "@/lib/live/live-preview-callouts";
import { drawEmbed } from "@/lib/live/live-preview-embeds";
import { drawFence, retheme, rethemes } from "@/lib/live/live-preview-fences";
import {
  isLineRevealed,
  isNodeRevealed,
  nudgeOutOfHidden,
  Walk,
} from "@/lib/live/live-preview-hidden";
import { drawImage } from "@/lib/live/live-preview-images";
import {
  drawInline,
  drawLink,
  drawRuby,
  INLINE,
  markRelation,
} from "@/lib/live/live-preview-inline";
import { Lists } from "@/lib/live/live-preview-lists";
import { drawBlockMath, drawInlineMath } from "@/lib/live/live-preview-math";
import { drawSvg } from "@/lib/live/live-preview-svg";
import { drawTable } from "@/lib/live/live-preview-tables";
import { drawTime, linkedVideos } from "@/lib/live/live-preview-times";
import { videoLayer } from "@/lib/live/live-preview-video";
import { watchPresses } from "@/lib/presses";
import { vaultPaths } from "@/lib/wikilink";

const HEADING = /^ATXHeading([1-6])$/;

/**
 * What the editor is showing, and which parts of the document it is not.
 *
 * The two travel together because the selection filter has to know where the
 * hidden ranges are, and a filter can only read state.
 */
interface Live {
  decorations: DecorationSet;
  hidden: RangeSet<Decoration>;
}

function build(state: EditorState): Live {
  const walk = new Walk(state);
  const callouts = new Callouts();
  const lists = new Lists();
  // One read of the note's videos for the whole walk, shared by every stamp.
  const linked = linkedVideos(state);

  syntaxTree(state).iterate({
    enter(node) {
      // Inside a table the widget has already drawn: nothing there is on the
      // screen to decorate.
      if (node.to <= walk.drawn) return false;
      if (callouts.covers(node.from, node.to)) return false;

      const heading = HEADING.exec(node.name);
      const inline = INLINE[node.name];
      const isLink = node.name === "Link";
      const isQuote = node.name === "QuoteMark";
      const isBlockquote = node.name === "Blockquote";
      const isBullet = node.name === "ListMark" && node.node.parent?.parent?.name === "BulletList";
      const isFence = node.name === "FencedCode";
      const isRule = node.name === "HorizontalRule";
      const isImage = node.name === "Image";
      const isTable = node.name === "Table";
      const isTag = node.name === "Tag";
      const isEmbed = node.name === "Embed";
      const isEscape = node.name === "Escape";
      const isInlineMath = node.name === "InlineMath";
      const isBlockMath = node.name === "BlockMath";
      const isHtml = node.name === "HTMLBlock" || node.name === "Paragraph";
      const isRuby =
        node.name === "HTMLTag" && state.doc.sliceString(node.from, node.to) === "<ruby>";
      if (
        !isRuby &&
        !isEscape &&
        !isEmbed &&
        !heading &&
        !inline &&
        !isLink &&
        !isQuote &&
        !isBlockquote &&
        !isBullet &&
        !isFence &&
        !isRule &&
        !isImage &&
        !isTable &&
        !isTag &&
        !isInlineMath &&
        !isBlockMath &&
        !isHtml
      ) {
        return;
      }

      if (isBlockquote) {
        callouts.enter(walk, node.node);
        return;
      }

      // Coloured and left where it is, like the overdue red below: the hash is
      // part of the tag rather than a mark standing in front of one, so there
      // is nothing here for a revealed line to bring back.
      if (isTag) {
        walk.decorations.push(Decoration.mark({ class: "cm-tag" }).range(node.from, node.to));
        return;
      }

      if (isFence) return drawFence(walk, node.node);

      // A paragraph that is not an svg has nothing of its own to decorate, so it
      // is left to its children as it was before this check.
      if (isHtml) return drawSvg(walk, node.node);

      if (isTable) {
        drawTable(walk, node.node);
        return;
      }

      if (isBlockMath) return drawBlockMath(walk, node.node);

      const line = state.doc.lineAt(node.from);
      const revealed = isLineRevealed(state, line) || node.from < walk.tableEnd;

      // `\*` is the asterisk, and the backslash is a mark like any other. An
      // Anki card side opening with a fence is written with a backslash before
      // its backticks so it opens none, and should read as the backticks. By
      // the line rule, so the cursor's line and a table's source keep it.
      if (isEscape) {
        if (!revealed) walk.hide(node.from, node.from + 1);
        return;
      }

      if (isEmbed) {
        drawEmbed(walk, node.node, revealed, renderedMarkdown);
        return false;
      }

      // The line is drawn, so the dashes asking for it go. Like the bullet and
      // unlike the blockquote's bar, the drawing stands in for characters, so
      // it leaves when they come back. `---` under a paragraph is a setext
      // heading rather than a rule, and the parser has already told them apart.
      if (isRule) {
        if (revealed) return;
        walk.decorations.push(Decoration.line({ class: "cm-rule" }).range(line.from));
        walk.hide(line.from, line.to);
        return;
      }

      if (heading) {
        // The size stays put while the marks come and go, so revealing a line
        // does not make it jump.
        walk.decorations.push(
          Decoration.line({ class: `cm-heading-${heading[1]}` }).range(line.from),
        );
        if (revealed) return;

        const mark = node.node.firstChild;
        if (mark?.name !== "HeaderMark") return;
        walk.hideLeader(mark.from, mark.to, line);
        return;
      }

      // Left for after the walk, when the callouts around the line are known.
      if (isQuote) {
        callouts.quote(node.from, node.to, line, revealed);
        return;
      }

      // The dot is drawn in CSS, so it has to go the moment the `-` it stands
      // in for comes back, or the line carries two bullets. An ordered list is
      // left alone throughout: its number is content, not decoration.
      if (isBullet) {
        lists.bullet(walk, node.node, line, revealed);
        return;
      }

      if (isImage) {
        drawImage(walk, node.node, revealed);
        return;
      }

      if (isRuby) {
        drawRuby(walk, node.from, line, revealed);
        return;
      }

      // A link and the inline constructs below it are read off the node: the
      // cursor has to be in the one whose marks come back. Everything above is
      // a line construct, whose mark sits at the head of the line and whose two
      // rules therefore say the same thing.
      const inlineRevealed = isNodeRevealed(state, node.from, node.to) || node.from < walk.tableEnd;

      if (isInlineMath) {
        drawInlineMath(walk, node.from, node.to, inlineRevealed);
        return false;
      }

      if (isLink) {
        // Ahead of the link, which would otherwise colour and hide the time
        // and leave a take's address a link to open.
        if (drawTime(walk, node.node, revealed, linked)) return;
        drawLink(walk, node.node, line, inlineRevealed);
        return;
      }

      if (node.name === "WikiLink") markRelation(walk, node.from, line);

      if (!inline) return;
      drawInline(walk, node.node, inline, inlineRevealed);
    },
  });

  callouts.finish(walk);
  lists.finish(walk);

  return {
    decorations: Decoration.set(walk.decorations, true),
    hidden: Decoration.set(walk.hidden, true),
  };
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
  const old = <T extends Decoration>(set: RangeSet<T>) =>
    (tr.docChanged ? set.map(tr.changes) : set).update({ filter: keep });
  return {
    decorations: RangeSet.join([fresh.decorations, old(value.decorations)]),
    hidden: RangeSet.join([fresh.hidden, old(value.hidden)]),
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
      tr.startState.facet(embedSource) !== tr.state.facet(embedSource);
    // A long note is parsed in slices off the main thread's idle time, each
    // slice landing as a transaction that changes nothing else. Without this
    // the text past the first slice stays raw until the cursor moves.
    const parsed = syntaxTree(tr.startState) !== syntaxTree(tr.state);
    const flipped = tr.effects.some((effect) => effect.is(toggleFold));
    // A diagram is drawn in the theme it was built in, so a switch builds it again.
    const rethemed = tr.effects.some((effect) => effect.is(retheme));
    if (
      !tr.docChanged &&
      !tr.selection &&
      !modeChanged &&
      !vaultChanged &&
      !parsed &&
      !flipped &&
      !rethemed
    ) {
      return value;
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
  if (!tr.selection) return tr;

  const hidden = tr.startState.field(live).hidden.map(tr.changes);
  const nudged = nudgeOutOfHidden(tr.selection, tr.startState.selection, hidden, tr.newDoc);
  return nudged ? [tr, { selection: nudged }] : tr;
});

export function livePreview(): Extension {
  // The picture's and the table's follows read the presses too, and a view
  // may be mounted without the editor that would watch them.
  watchPresses();
  return [vimModeState(), folds, live, foldClicks, nudgeSelection, rethemes, videoLayer];
}

/**
 * The rendering on its own, for a view with no vim and no cursor.
 * Keeps `vimModeField` and `folds`, which `live` reads; the default reveals nothing.
 */
export function renderedMarkdown(): Extension {
  // For the reason `livePreview` watches them: a preview may be the only view.
  watchPresses();
  return [vimModeField, folds, live, foldClicks, rethemes, videoLayer];
}
