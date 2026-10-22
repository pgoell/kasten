import { syntaxTree } from "@codemirror/language";
import { EditorState, type Extension, type RangeSet, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { embedSource } from "@/lib/embed";
import { imagePaths } from "@/lib/image";
import { Callouts, foldClicks, folds, toggleFold } from "@/lib/live-preview-callouts";
import { drawEmbed } from "@/lib/live-preview-embeds";
import { drawFence, retheme, rethemes } from "@/lib/live-preview-fences";
import { isLineRevealed, isNodeRevealed, nudgeOutOfHidden, Walk } from "@/lib/live-preview-hidden";
import { drawImage } from "@/lib/live-preview-images";
import { drawInline, drawLink, drawRuby, INLINE, markRelation } from "@/lib/live-preview-inline";
import { Lists } from "@/lib/live-preview-lists";
import { drawBlockMath, drawInlineMath } from "@/lib/live-preview-math";
import { drawTable } from "@/lib/live-preview-tables";
import { watchPresses } from "@/lib/presses";
import { setVimMode, vimKeys, vimModeField, vimModeState } from "@/lib/vim-mode";
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
        !isBlockMath
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
    return build(tr.state);
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

/**
 * Keeps the cursor out of the hidden marks.
 *
 * Reads the ranges from the state before the transaction, mapped through its
 * changes. Reading `tr.state` instead would compute the new state from inside
 * the filter that helps produce it.
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
  return [vimModeState(), folds, live, foldClicks, nudgeSelection, rethemes];
}

/**
 * The rendering on its own, for a view with no vim and no cursor in it.
 *
 * What the preview panes mount. The bridge is left out because it asks
 * `getCM` for a vim instance the view does not have, and the selection filter
 * because there is no cursor to keep out of the hidden marks. `vimModeField`
 * stays: `live` reads it to decide which line shows its source, and its
 * default of normal mode is the one that reveals nothing, so a cursorless view
 * renders every line. `folds` too, which `live` reads, so a callout in a
 * preview opens and shuts by click as it does in the editor.
 */
export function renderedMarkdown(): Extension {
  // For the reason `livePreview` watches them: a preview may be the only view.
  watchPresses();
  return [vimModeField, folds, live, foldClicks, rethemes];
}
