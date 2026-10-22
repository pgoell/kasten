import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

// Every colour is a token, so the editor switches with data-theme at runtime.
// That is also why this is not `dark: true`: the flag is fixed when the
// extension is built, and the tokens are not.

const theme = EditorView.theme({
  "&": { color: "var(--k-ink)", backgroundColor: "var(--k-bg)" },
  ".cm-content": { caretColor: "var(--k-accent)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--k-accent)" },
  // The vim block cursor comes from @replit/codemirror-vim at the highest
  // precedence, on the same selector with its own colour. `&.cm-focused` adds
  // specificity so this wins. Its unfocused outline is #ff9696, and only
  // !important replaces it.
  "&.cm-focused .cm-fat-cursor": {
    background: "var(--k-accent)",
    color: "var(--k-paper)",
  },
  "&:not(.cm-focused) .cm-fat-cursor": {
    outline: "1px solid var(--k-accent) !important",
  },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    { background: "var(--k-highlight)" },
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-gutters": {
    backgroundColor: "var(--k-bg)",
    color: "var(--k-muted)",
    border: "none",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "var(--k-ink)",
  },
  ".cm-panels": {
    backgroundColor: "var(--k-paper)",
    color: "var(--k-ink)",
  },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--k-rule)" },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--k-rule)" },
  ".cm-searchMatch": {
    backgroundColor: "var(--k-mark)",
    outline: "1px solid var(--k-rule-strong)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "var(--k-mark)",
  },
  ".cm-selectionMatch": { backgroundColor: "var(--k-accent-wash)" },
  ".cm-matchingBracket": {
    outline: "1px solid var(--k-rule-strong)",
    backgroundColor: "transparent",
  },
  ".cm-nonmatchingBracket": {
    outline: "1px solid var(--k-danger)",
    backgroundColor: "transparent",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--k-surface)",
    border: "none",
    color: "var(--k-muted)",
  },
  ".cm-tooltip, .cm-tooltip-autocomplete": {
    backgroundColor: "var(--k-paper)",
    color: "var(--k-ink)",
    border: "1px solid var(--k-rule)",
    boxShadow: "var(--k-shadow)",
  },
  ".cm-tooltip .cm-tooltip-arrow:before": {
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
  },
  ".cm-tooltip .cm-tooltip-arrow:after": {
    borderTopColor: "var(--k-paper)",
    borderBottomColor: "var(--k-paper)",
  },
  ".cm-tooltip-autocomplete": {
    "& > ul > li[aria-selected]": {
      backgroundColor: "var(--k-accent-wash)",
      color: "var(--k-ink)",
    },
  },
});

const highlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "bold", color: "var(--k-ink)" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.url, color: "var(--k-link)" },
  { tag: tags.link, color: "var(--k-link)", textDecoration: "underline" },
  {
    tag: [tags.processingInstruction, tags.meta, tags.comment],
    color: "var(--k-muted)",
  },
  { tag: [tags.keyword, tags.modifier], color: "var(--k-accent)" },
  {
    tag: [tags.string, tags.special(tags.string), tags.regexp, tags.inserted],
    color: "var(--k-ok)",
  },
  {
    tag: [
      tags.number,
      tags.bool,
      tags.atom,
      tags.null,
      tags.color,
      tags.constant(tags.name),
      tags.standard(tags.name),
      tags.special(tags.variableName),
      tags.changed,
      tags.annotation,
      tags.self,
    ],
    color: "var(--k-warn)",
  },
  {
    tag: [tags.function(tags.variableName), tags.labelName, tags.propertyName],
    color: "var(--k-info)",
  },
  {
    tag: [tags.typeName, tags.className, tags.namespace],
    color: "var(--tg-4)",
  },
  {
    tag: [tags.operator, tags.operatorKeyword, tags.escape, tags.punctuation],
    color: "var(--k-ink-soft)",
  },
  { tag: tags.quote, color: "var(--k-ink-soft)" },
  { tag: tags.invalid, color: "var(--k-danger)" },
  { tag: tags.variableName, color: "var(--k-ink)" },
  {
    tag: [tags.name, tags.character, tags.macroName, tags.definition(tags.name), tags.separator],
    color: "var(--k-ink)",
  },
  { tag: tags.deleted, color: "var(--k-danger)" },
]);

export const kastenTheme: Extension = [theme, syntaxHighlighting(highlight)];
