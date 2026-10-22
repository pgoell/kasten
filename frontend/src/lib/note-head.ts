import {
  type EditorState,
  type Extension,
  Facet,
  StateEffect,
  StateField,
  type Text,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { followHandler } from "@/lib/editor-follow";
import { belowFrontmatter } from "@/lib/frontmatter-language";
import { noteBody, readField } from "@/lib/note-frontmatter";
import { type Outline, outlinePlugin, proseLines } from "@/lib/note-outline";
import { noteName } from "@/lib/note-path";
import { type Relation, readRelation } from "@/lib/relation";
import { tagsOf } from "@/lib/tag-rule";
import { notePath } from "@/lib/todo-commands";

export type { Outline, OutlineHeading } from "@/lib/note-outline";

/**
 * Whether live preview is on, which is what Read means. The preview compartment
 * holds this beside the rendering, so it reads true exactly when the rendering
 * is, and a toggle of either is a toggle of both.
 */
export const readMode = Facet.define<boolean, boolean>({
  combine: (values) => values[0] ?? false,
});

/** Opens or closes the list of properties. */
const setProperties = StateEffect.define<boolean>();

/** Kept in state, not in the widget, so a widget rebuilt by an edit stays as the reader left it. */
const propertiesOpen = StateField.define<boolean>({
  create: () => false,
  update(open, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setProperties)) return effect.value;
    }
    return open;
  },
});

/** What the header shows, read off the note's text. */
interface Head {
  /** The folders the note sits in, joined for the breadcrumb. Empty at the top of the vault. */
  folders: string;
  title: string;
  type: string | null;
  /** The `modified:` stamp spelled out, or null where it is missing or unreadable. */
  modified: string | null;
  words: number;
  /** Tag names without the hash, from the frontmatter and from the body, each once. */
  tags: string[];
  /** Every frontmatter field, or null where the note has no frontmatter. */
  properties: [string, string][] | null;
  relations: Relation[];
}

/** What the widget draws: the head and the two flags it is drawn with. */
type Drawn = Head & { read: boolean; open: boolean };

/** What Read hides: the frontmatter's closing line ends at `frontEnd`, and the decorations do the hiding. */
interface Hiding {
  frontEnd: number;
  decorations: DecorationSet;
}

/** The end of the frontmatter's closing line, or 0 where there is no block. */
function frontEndOf(doc: Text): number {
  const after = belowFrontmatter(doc.toString());
  // `belowFrontmatter` answers the start of the line after the closing fence,
  // whose newline is the last character of the closing line.
  return after === 0 ? 0 : doc.lineAt(after - 1).to;
}

/** The line the body starts on, which is where the outline's headings begin. */
function bodyLineOf(doc: Text): number {
  const end = frontEndOf(doc);
  return end === 0 ? 1 : doc.lineAt(end).number + 1;
}

/** Every frontmatter field in order, as `[name, value]`, a list's items joined with commas. */
function fieldsOf(block: string[]): [string, string][] {
  const fields: [string, string][] = [];
  for (const line of block) {
    const found = /^([A-Za-z_][\w-]*)\s*:(.*)$/.exec(line);
    if (found?.[1] !== undefined && found[2] !== undefined) {
      fields.push([found[1], found[2].trim()]);
      continue;
    }
    // An item of a block list under the field above it.
    const last = fields[fields.length - 1];
    const item = /^\s*-\s+(.*)$/.exec(line)?.[1];
    if (last !== undefined && item !== undefined) {
      last[1] = [last[1], item].filter((part) => part !== "").join(", ");
    }
  }
  return fields;
}

/** The names a value holds, whether written `[a, b]` or as a block list joined by `fieldsOf`. */
function listOf(value: string): string[] {
  return value
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((name) =>
      name
        .trim()
        .replace(/^["']|["']$/g, "")
        .replace(/^#/, ""),
    )
    .filter((name) => name !== "");
}

/** A stamp such as `2026-10-21T10:00:00+00:00`, as `21 Oct 2026`, or null where it reads as no date. */
function dateOf(stamp: string): string | null {
  const when = new Date(stamp);
  if (Number.isNaN(when.getTime())) return null;
  return when.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** A relation's name as the header says it: hyphens as spaces, the first letter capital. */
function labelOf(name: string): string {
  const spaced = name.replace(/-/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** The header's content, read off the whole text of a note under `path`. */
function headOf(doc: Text, path: string, frontEnd: number): Head {
  const text = doc.toString();
  // The body's lines only, so a `#` or a relation in the frontmatter is not
  // read as one of the note's own.
  const lines = proseLines(doc, frontEnd === 0 ? 1 : doc.lineAt(frontEnd).number + 1);
  const fields = frontEnd === 0 ? null : fieldsOf(text.slice(0, frontEnd).split("\n"));
  const tagged = fields?.find(([name]) => name === "tags")?.[1] ?? "";
  const tags = [
    ...listOf(tagged),
    ...lines.flatMap(({ text: line }) => tagsOf(line).map(({ tag }) => tag.slice(1))),
  ];
  const stamp = readField(text, "modified");
  return {
    folders: path.split("/").slice(0, -1).join(" / "),
    title: noteName(path),
    type: readField(text, "type") || null,
    modified: stamp === undefined ? null : dateOf(stamp),
    words: noteBody(text)
      .split(/\s+/)
      .filter((word) => word !== "").length,
    tags: [...new Set(tags)],
    properties: fields,
    relations: lines.flatMap(({ text: line }) => {
      const relation = readRelation(line);
      return relation === null ? [] : [relation];
    }),
  };
}

/** The head of the note in `state`, or null where the view holds no note. */
function read(state: EditorState): { head: Head | null; frontEnd: number } {
  const frontEnd = frontEndOf(state.doc);
  const path = state.facet(notePath);
  return { head: path === undefined ? null : headOf(state.doc, path, frontEnd), frontEnd };
}

/** An element with its attributes set, which is all the header needs of the DOM. */
function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string>,
  text?: string,
): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) made.setAttribute(name, value);
  if (text !== undefined) made.textContent = text;
  return made;
}

/**
 * A button that keeps the editor's focus. CodeMirror ignores the header's events,
 * so a press here must not move the selection either.
 */
function button(
  words: string,
  attrs: Record<string, string>,
  press: () => void,
): HTMLButtonElement {
  const made = make("button", { type: "button", ...attrs }, words);
  made.addEventListener("mousedown", (event) => event.preventDefault());
  made.addEventListener("click", press);
  return made;
}

/** The breadcrumb's row: the folders on the left, the Read and Edit switch on the right. */
function rowOf(d: Drawn, toggle: () => void): HTMLElement {
  const row = make("div", { class: "cm-note-row" });
  const group = make("div", { class: "cm-note-mode", "data-head": "mode" });
  for (const [label, reading] of [
    ["Read", true],
    ["Edit", false],
  ] as const) {
    const active = d.read === reading;
    // The active one does nothing: only the other is a change.
    group.append(
      button(label, { class: "cm-note-mode-button", "aria-pressed": String(active) }, () => {
        if (!active) toggle();
      }),
    );
  }
  row.append(make("span", { class: "cm-note-path", "data-head": "path" }, d.folders), group);
  return row;
}

/** The line of meta: type, edited date, words, then one pill per tag. */
function metaOf(d: Drawn): HTMLElement {
  const meta = make("div", { class: "cm-note-meta", "data-head": "meta" });
  if (d.type !== null) meta.append(make("span", {}, d.type));
  if (d.modified !== null) meta.append(make("span", {}, d.modified));
  meta.append(make("span", {}, `${d.words} ${d.words === 1 ? "word" : "words"}`));
  for (const tag of d.tags) meta.append(make("span", { class: "cm-note-tag" }, `#${tag}`));
  return meta;
}

/** The Properties link, and under it the list of every field when the link is open. */
function propertiesOf(view: EditorView, d: Drawn): HTMLElement[] {
  const link = button("Properties", { class: "cm-note-link", "data-head": "properties" }, () =>
    view.dispatch({ effects: setProperties.of(!d.open) }),
  );
  if (!d.open || d.properties === null) return [link];

  const list = make("div", { class: "cm-note-property-list", "data-head": "property-list" });
  for (const [name, value] of d.properties) {
    const line = make("div", { class: "cm-note-property" });
    line.append(
      make("span", { class: "cm-note-key" }, name),
      make("span", { class: "cm-note-value" }, value),
    );
    list.append(line);
  }
  return [link, list];
}

/** One plain line per relation, its target a link that follows it. */
function relationsOf(view: EditorView, relations: Relation[]): HTMLElement {
  const block = make("div", { class: "cm-note-relations", "data-head": "relations" });
  for (const relation of relations) {
    const line = make("div", { class: "cm-note-relation" }, `${labelOf(relation.name)} `);
    const target = make("span", { class: "cm-note-link" }, relation.target);
    target.addEventListener("click", () => view.state.facet(followHandler)?.(relation.target));
    line.append(target);
    block.append(line);
  }
  return block;
}

/** The elements the header is made of, in the order it shows them. */
function partsOf(view: EditorView, d: Drawn, toggle: () => void): HTMLElement[] {
  const parts: HTMLElement[] = [
    rowOf(d, toggle),
    make("h1", { class: "cm-note-title", "data-head": "title" }, d.title),
    metaOf(d),
  ];
  if (d.properties !== null) parts.push(...propertiesOf(view, d));
  if (d.relations.length > 0) parts.push(relationsOf(view, d.relations));
  return parts;
}

/**
 * Draws the header above the note, as a child of the scroller and not of the
 * content, so the content's text is the note's own and the header scrolls with it.
 *
 * The header is absolute at the top of the scroller, which is positioned, and the
 * content's top padding grows by its height so the first line starts below it.
 * Its inner DOM is rebuilt only when what it shows changes, and its clicks are
 * outside the content, which CodeMirror leaves alone.
 */
class HeadPlugin {
  private readonly view: EditorView;
  private readonly toggle: () => void;
  private readonly head: HTMLElement | null;
  /** The content's own top padding, which the header's height is added to. */
  private readonly basePadding: number;
  private observer: ResizeObserver | null = null;
  private data: Head | null;
  private shown = "";

  constructor(view: EditorView, toggle: () => void) {
    this.view = view;
    this.toggle = toggle;
    this.data = read(view.state).head;
    this.head =
      view.state.facet(notePath) === undefined ? null : make("div", { class: "cm-note-head" });
    this.basePadding = parseFloat(getComputedStyle(view.contentDOM).paddingTop) || 0;
    if (this.head) {
      view.scrollDOM.insertBefore(this.head, view.contentDOM);
      // jsdom has no ResizeObserver, and a browser without one is measured on each change.
      if (typeof ResizeObserver !== "undefined") {
        this.observer = new ResizeObserver(() => this.measure());
        this.observer.observe(this.head);
        this.observer.observe(view.contentDOM);
      }
    }
    this.draw(view.state);
  }

  update(update: ViewUpdate) {
    if (update.docChanged) this.data = read(update.state).head;
    this.draw(update.state);
  }

  destroy() {
    this.observer?.disconnect();
    if (this.head === null) return;
    this.head.remove();
    this.view.contentDOM.style.paddingTop = "";
  }

  /** Rebuilds the header's inner DOM when what it shows has changed, then measures it. */
  private draw(state: EditorState) {
    if (this.head === null) return;
    const drawn =
      this.data === null
        ? null
        : {
            ...this.data,
            read: state.facet(readMode),
            open: state.field(propertiesOpen),
          };
    const key = JSON.stringify(drawn);
    if (key === this.shown) return;
    this.shown = key;
    this.head.replaceChildren(...(drawn === null ? [] : partsOf(this.view, drawn, this.toggle)));
    this.measure();
  }

  /** Reads the header's place and height, then writes them, in the view's measure cycle. */
  private measure() {
    const { head, view } = this;
    if (head === null) return;
    view.requestMeasure({
      read: () => ({
        left: view.contentDOM.offsetLeft,
        width: view.contentDOM.clientWidth,
        height: head.offsetHeight,
      }),
      write: ({ left, width, height }) => {
        head.style.left = `${left}px`;
        head.style.width = `${width}px`;
        view.contentDOM.style.paddingTop = `${this.basePadding + height}px`;
      },
    });
  }
}

/** The header's look, in the tokens so both themes follow the palette. */
const headTheme = EditorView.theme({
  ".cm-note-head": {
    position: "absolute",
    top: "0",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: "var(--k-space-8)",
    padding: "var(--k-space-24) 0 var(--k-space-24)",
    fontFamily: "var(--k-sans)",
    fontSize: "var(--k-text-13)",
    color: "var(--k-ink)",
  },
  ".cm-note-row": {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "var(--k-space-12)",
  },
  ".cm-note-path": { fontFamily: "var(--k-mono)", color: "var(--k-muted)" },
  ".cm-note-mode": {
    display: "inline-flex",
    border: "1px solid var(--k-rule)",
    borderRadius: "var(--k-radius-6)",
  },
  ".cm-note-mode-button": {
    font: "inherit",
    background: "none",
    border: "0",
    color: "var(--k-muted)",
    padding: "var(--k-space-4) var(--k-space-12)",
    cursor: "pointer",
  },
  '.cm-note-mode-button[aria-pressed="true"]': {
    color: "var(--k-ink)",
    background: "var(--k-surface)",
  },
  ".cm-note-title": {
    margin: "0",
    fontFamily: "var(--k-serif)",
    fontSize: "var(--k-text-36)",
    fontWeight: "normal",
    lineHeight: "var(--k-leading-title)",
    letterSpacing: "var(--k-track-title)",
  },
  ".cm-note-meta": {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "var(--k-space-12)",
    color: "var(--k-muted)",
  },
  ".cm-note-tag": {
    background: "var(--k-accent-wash)",
    color: "var(--k-accent)",
    borderRadius: "999px",
    padding: "0 8px",
  },
  ".cm-note-link": {
    font: "inherit",
    background: "none",
    border: "0",
    padding: "0",
    color: "var(--k-link)",
    cursor: "pointer",
    // Shrinks to its words and sits on the header's left edge, not in the middle of the column.
    alignSelf: "flex-start",
    textAlign: "left",
  },
  ".cm-note-property": { display: "flex", gap: "var(--k-space-12)" },
  ".cm-note-key": { color: "var(--k-muted)" },
  ".cm-note-value": { fontFamily: "var(--k-mono)" },
  ".cm-note-relations": { fontSize: "var(--k-text-15)" },
});

/**
 * The note's header and outline, as one extension.
 *
 * The header is drawn beside the content by a view plugin, so the text of the note
 * is never the header's. Read hides the frontmatter, except while the cursor is in
 * it, the way live preview shows the markup of the line under the cursor. That is
 * a block decoration, which only a field may make.
 */
export function noteHead(o: {
  toggle: () => void;
  outline: (outline: Outline) => void;
}): Extension {
  const frontmatter = StateField.define<Hiding>({
    create: (state) => hiding(state, frontEndOf(state.doc)),
    update(value, tr) {
      const changed = tr.docChanged || tr.state.facet(readMode) !== tr.startState.facet(readMode);
      if (!changed && !tr.selection) return value;
      return hiding(tr.state, tr.docChanged ? frontEndOf(tr.state.doc) : value.frontEnd);
    },
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
  });
  const head = ViewPlugin.define((view) => new HeadPlugin(view, o.toggle));
  return [propertiesOpen, frontmatter, headTheme, head, outlinePlugin(o.outline, bodyLineOf)];
}

/** The hiding for one frontmatter, in the read or edit state the view is in now. */
function hiding(state: EditorState, frontEnd: number): Hiding {
  // Hidden only while the cursor is below the frontmatter: inside it, or on its
  // closing line, the YAML shows as text.
  const hidden =
    state.facet(notePath) !== undefined &&
    state.facet(readMode) &&
    frontEnd > 0 &&
    state.selection.main.head > frontEnd;
  return {
    frontEnd,
    decorations: hidden
      ? Decoration.set([Decoration.replace({ block: true }).range(0, frontEnd)])
      : Decoration.none,
  };
}
