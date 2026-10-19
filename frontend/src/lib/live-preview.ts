import { syntaxTree } from "@codemirror/language";
import type { Extension, Line, Range, Text } from "@codemirror/state";
import {
  EditorSelection,
  EditorState,
  Facet,
  MapMode,
  type RangeSet,
  StateEffect,
  StateField,
} from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { isAudio } from "@/lib/audio";
import { parseCallout } from "@/lib/callout";
import { readClock } from "@/lib/clock";
import { EMBED_DEPTH, type EmbedSource, embedDepth, embedSource } from "@/lib/embed";
import { imagePaths, imageSource } from "@/lib/image";
import { linkAddress, unescaped, urlLinkAt } from "@/lib/link-reference";
import { loadKatex } from "@/lib/math";
import { type Drawing, drawMermaid, drawnMermaid } from "@/lib/mermaid";
import { noteBody } from "@/lib/note-frontmatter";
import { noteLanguage } from "@/lib/note-language";
import { encodePath } from "@/lib/note-path";
import { noteSectionOf } from "@/lib/note-section";
import { type PdfRenderer, pdfRenderer, showPdf } from "@/lib/pdf-view";
import { readRelation } from "@/lib/relation";
import { type Align, alignsOf, isRow } from "@/lib/table";
import { DUE, masked, parseTodo } from "@/lib/todo";
import { descendants, type Placed, progressOf, treeOf } from "@/lib/todo-view";
import { playerUrl, videoId, watchedAt } from "@/lib/video";
import {
  editingMode,
  setVimMode,
  type VimMode,
  vimKeys,
  vimModeField,
  vimModeState,
} from "@/lib/vim-mode";
import {
  pdfPage,
  resolveIn,
  splitTarget,
  vaultPaths,
  wikiLinkLands,
  wikiLinkPath,
} from "@/lib/wikilink";

/** An empty replacement: the range is in the document but not on the screen. */
const HIDDEN = Decoration.replace({});

/** A folded callout's body, told apart from `HIDDEN` by `skipHidden`. */
const FOLDED = Decoration.replace({});

const HEADING = /^ATXHeading([1-6])$/;

/** How far one level of list nesting shifts a rendered item, in `em`. */
const BULLET_INDENT = 1.6;

/**
 * Today, read once when the module loads.
 *
 * ponytail: a tab left open across midnight keeps yesterday's idea of overdue
 * until it reloads. The upgrade is a facet carrying the date through the
 * editor, which is more machinery than one colour is worth.
 */
const TODAY = readClock(new Date()).date;

/** How far past the list mark a box reaches: ` [s]`, whatever the indent is. */
const BOX_WIDTH = 4;

/**
 * How many lists a list item sits inside.
 *
 * The spaces that nest an item are hidden along with its `-`, so nothing in
 * the text carries the nesting any more and the indent has to be drawn from
 * the depth instead.
 */
function listDepth(node: SyntaxNode): number {
  let depth = 0;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.name === "BulletList" || parent.name === "OrderedList") depth++;
  }
  return depth;
}

/**
 * Inline constructs, by the node that wraps them.
 *
 * Keyed by the wrapper rather than the delimiter because the delimiter does not
 * identify the construct: `EmphasisMark` is both `**` and `*`, and only the
 * parent says which.
 */
const INLINE: Record<string, { mark: string; class: string }> = {
  StrongEmphasis: { mark: "EmphasisMark", class: "cm-strong" },
  Emphasis: { mark: "EmphasisMark", class: "cm-emphasis" },
  InlineCode: { mark: "CodeMark", class: "cm-inline-code" },
  Strikethrough: { mark: "StrikethroughMark", class: "cm-strikethrough" },
  Highlight: { mark: "HighlightMark", class: "cm-highlight" },
  // Its two `[[` and `]]` marks are the pair this reads, so a wikilink renders
  // as the note it names with nothing here that a bold word does not need.
  WikiLink: { mark: "WikiLinkMark", class: "cm-wikilink" },
};

/**
 * `3/5` drawn after a parent's line.
 *
 * A widget rather than a class on the text, there being no text to hang it on:
 * the count is a reading of the lines below and nothing in the document says it.
 */
class Progress extends WidgetType {
  private readonly label: string;

  // Written out rather than as a parameter property, which `erasableSyntaxOnly`
  // does not allow: that syntax is the one piece of TypeScript that emits code.
  constructor(label: string) {
    super();
    this.label = label;
  }

  override eq(other: Progress): boolean {
    return other.label === this.label;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-todo-progress";
    span.textContent = this.label;
    return span;
  }
}

/**
 * The picture an `![](path)` names, drawn in place of the text naming it.
 *
 * The one widget here that loads something. A picture arrives with no size and
 * gets one when its bytes land, by which time CodeMirror has measured the line
 * as the height of an empty element, so the load asks for that measurement
 * again. Without it the note below the image sits under it until something else
 * moves the cursor.
 */
class Picture extends WidgetType {
  private readonly picture: Pictured;

  constructor(picture: Pictured) {
    super();
    this.picture = picture;
  }

  override eq(other: Picture): boolean {
    const [a, b] = [other.picture, this.picture];
    return a.source === b.source && a.alt === b.alt && a.width === b.width && a.height === b.height;
  }

  toDOM(view: EditorView): HTMLElement {
    const image = pictureElement(view, this.picture);
    // A tap or a click puts the cursor on the picture, which is what shows its
    // source. CodeMirror leaves both to the browser, the widget swallowing the
    // press, and the browser puts no caret on a picture (#552). Here and not in
    // `pictureElement`: a table's cell already has the block's handler.
    //
    // A picture inside a link follows it instead, as the link's text does
    // (#558). The editor's own tap and ctrl+click never hear of a press the
    // widget swallowed, so the follow is here, under the rule `followOnTap`
    // keeps: a link the cursor is already in is one being edited.
    image.addEventListener("click", (event) => {
      if (!image.isConnected) return;
      const at = view.posAtDOM(image);
      const link = urlLinkAt(syntaxTree(view.state).resolveInner(at, 1), view.state.doc);
      const head = view.state.selection.main.head;
      if (link !== null && (head < link.from || head > link.to)) {
        // A double-click sends a click for each press, and the follow leaves
        // the cursor where it was, so the second would open a second tab.
        if (event.detail <= 1) window.open(link.address, "_blank", "noopener");
      } else {
        view.dispatch({ selection: { anchor: at } });
      }
    });
    return image;
  }
}

/** What a picture is drawn from, the size being one an embed's alias asks for. */
interface Pictured {
  source: string;
  alt: string;
  width?: number;
  height?: number;
}

/** The `img` a picture is drawn as, on a line of its own or in a table's cell. */
function pictureElement(view: EditorView, picture: Pictured): HTMLImageElement {
  const image = document.createElement("img");
  image.className = "cm-image";
  // Sites that refuse hotlinking mostly key on the referrer, and this one
  // would name the note being read.
  image.referrerPolicy = "no-referrer";
  image.src = picture.source;
  // The alt text the note wrote, which is empty for most images and is the
  // right value for one that carries no meaning of its own.
  image.alt = picture.alt;
  if (picture.width !== undefined) image.width = picture.width;
  if (picture.height !== undefined) {
    image.height = picture.height;
    // `.cm-image` sets `height: auto`, which a stylesheet rule wins over the
    // attribute with, and a height asked for in the note should hold.
    image.style.height = `${picture.height}px`;
  }
  image.addEventListener("load", () => view.requestMeasure());
  return image;
}

/**
 * The picture `![[name|alias]]` names, or null where the vault holds none.
 *
 * Read off the image listing by the rule a link finds its note by. The alias is
 * read as Obsidian reads it: `200` is a width, `200x100` a width and a height,
 * and anything else the alt text.
 */
function embeddedPicture(state: EditorState, name: string, alias: string | null): Pictured | null {
  const images = state.facet(imagePaths);
  const image = images === null ? null : resolveIn(name, images);
  if (image === null || !images?.includes(image)) return null;
  const source = imageSource(encodePath(image));
  if (source === null) return null;
  const size = /^(\d+)(?:x(\d+))?$/.exec(alias ?? "");
  if (size === null) return { source, alt: alias ?? "" };
  const [, width, height] = size;
  return { source, alt: "", width: Number(width), ...(height ? { height: Number(height) } : {}) };
}

/** What an `![alt](address)` is drawn as, or null for one that stays its source. */
type Drawn =
  | { kind: "video"; id: string }
  | { kind: "sound"; source: string }
  | { kind: "picture"; source: string; alt: string };

/**
 * The address of an `![alt](address)` with a space in it, and where it ends.
 *
 * CommonMark ends a bare address at a space, so the parser reads
 * `![shot](99 Misc/shot.png)` as a reference image `![shot]` and the rest as
 * text. Obsidian draws the picture, and a note it wrote says what it meant: an
 * `Image` ending in `]` with a `(` straight after it has the address that runs
 * to the first `)` on its line, spaces kept and no title read. Each space is
 * written `%20`, which is what kasten's own writers would have put there, the
 * rest being taken as already encoded, as `imageSource` takes any path. Null
 * for any other image. Copy as reads the node as CommonMark does.
 */
function spacedAddress(doc: Text, node: SyntaxNode): { address: string; to: number } | null {
  if (doc.sliceString(node.to - 1, node.to + 1) !== "](") return null;
  const end = Math.min(doc.lineAt(node.to).to, node.parent?.to ?? doc.length);
  const close = doc.sliceString(node.to + 1, end).indexOf(")");
  if (close === -1) return null;
  const typed = doc.sliceString(node.to + 1, node.to + 1 + close).trim();
  return { address: unescaped(typed).replaceAll(" ", "%20"), to: node.to + close + 2 };
}

/**
 * Reads an `Image` node into what it is drawn as.
 *
 * An address `imageSource` cannot load renders as its source instead, since a
 * broken picture would hide what the text says was meant. So does one with no
 * address, `![a]()` or a `![a][ref]` no definition names, which `imageSource`
 * would hand the assets route as the empty path. The parens of a spaced
 * address win over a definition of the alt text, as they do in Obsidian.
 */
function drawnImage(state: EditorState, node: SyntaxNode): Drawn | null {
  const address = spacedAddress(state.doc, node)?.address ?? linkAddress(node, state.doc);
  if (!address) return null;
  // The video first: a YouTube link is an `https:` address, which
  // `imageSource` passes as it stands, so asked second it would be handed to an
  // `img` and draw as a broken picture.
  const video = videoId(address);
  if (video !== null) return { kind: "video", id: video };
  const source = imageSource(address);
  if (source === null) return null;
  // A sound before a picture, by its suffix: the browser would draw an `.mp3`
  // handed to an `img` as a broken image.
  if (isAudio(address)) return { kind: "sound", source };

  const marks: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === "LinkMark") marks.push(child);
  }
  const [open, close] = marks;
  const alt = open && close ? state.doc.sliceString(open.to, close.from) : "";
  return { kind: "picture", source, alt };
}

/**
 * The player an `![](word.mp3)` is drawn as, which an Anki import writes.
 *
 * `preload="none"` because a deck note is a thousand lines of these, and
 * loading every one on opening the note is a thousand requests nobody asked
 * for. Nothing to measure: the controls have their size before anything loads.
 */
class Sound extends WidgetType {
  private readonly source: string;

  constructor(source: string) {
    super();
    this.source = source;
  }

  override eq(other: Sound): boolean {
    return other.source === this.source;
  }

  toDOM(): HTMLElement {
    const audio = document.createElement("audio");
    audio.className = "cm-audio";
    audio.controls = true;
    audio.setAttribute("preload", "none");
    audio.src = this.source;
    return audio;
  }
}

/**
 * The player an `![](youtube link)` is drawn as.
 *
 * The pane is still the way to watch something properly, `<leader>gv` keeping
 * the player in place while the note scrolls under your typing and `<leader>v`
 * starting and stopping it from the note. This is the other half: a clip
 * quoted in the middle of a note reads as the clip rather than as an address,
 * and it plays where it sits.
 *
 * Nothing is written back. The frame carries `enablejsapi=1` because
 * `playerUrl` writes it for the pane, but no subscription is taken out here, so
 * `watching:` moves only for the video the pane is playing.
 *
 * ponytail: the cursor on the line hands the source back, the way it does for
 * a picture, so clicking into the line stops a video mid-play. The upgrade is
 * to keep the widget and reveal the brackets around it, which is a second
 * rendering of the construct rather than the one every other one here uses.
 */
class Player extends WidgetType {
  private readonly id: string;
  private readonly url: string;

  constructor(id: string, start: number) {
    super();
    this.id = id;
    this.url = playerUrl(id, start);
  }

  /**
   * The id alone, and deliberately not the URL.
   *
   * The pane writes where you got to into the note, so the note changes while
   * you watch and the `start=` this was built with changes with it. Comparing
   * the URL would call that a different widget and remount the frame under a
   * video that is playing. Where it opens is read once, and the player owns
   * where it is after that.
   */
  override eq(other: Player): boolean {
    return other.id === this.id;
  }

  toDOM(): HTMLElement {
    const frame = document.createElement("iframe");
    frame.className = "cm-video";
    frame.src = this.url;
    frame.title = "video";
    // The same one thing the pane hands over, and for the same reason: a talk
    // followed properly is watched full width. No camera, no clipboard, no
    // autoplay it was not told to start.
    frame.allow = "fullscreen; picture-in-picture";
    frame.allowFullscreen = true;
    return frame;
  }
}

/**
 * One ruby as an Anki import writes it, `<ruby>漢字<rt>かんじ</rt></ruby>`.
 *
 * That shape and no other, base and reading plain text: it is what
 * `kasten_backend.anki` writes for furigana, and a ruby typed by hand in some
 * other shape stays as its source rather than drawn half right.
 */
const RUBY = /^<ruby>([^<]+)<rt>([^<]+)<\/rt><\/ruby>/;

/**
 * The reading over its base, the way Anki shows furigana.
 *
 * A widget rather than marks on the text, the editor drawing no HTML: the
 * tags would otherwise stand on the screen around the word. Drawn and hidden
 * by the image's rules, so the cursor's line shows the source to edit.
 */
class Ruby extends WidgetType {
  private readonly base: string;
  private readonly reading: string;

  constructor(base: string, reading: string) {
    super();
    this.base = base;
    this.reading = reading;
  }

  override eq(other: Ruby): boolean {
    return other.base === this.base && other.reading === this.reading;
  }

  toDOM(): HTMLElement {
    const ruby = document.createElement("ruby");
    ruby.className = "cm-ruby";
    ruby.append(this.base);
    const reading = ruby.appendChild(document.createElement("rt"));
    reading.textContent = this.reading;
    return ruby;
  }
}

/**
 * A formula, `$x$` inline or `$$x$$` as a block, drawn by KaTeX.
 *
 * The source stands in the box until KaTeX lands, and a formula KaTeX cannot
 * read stays its source in the warning colour, the parse error on hover,
 * rather than a blank. KaTeX draws the rest in whatever colour it sits in.
 * The box changes size when the drawing lands, so it asks for a measure the
 * way a picture does.
 */
class Formula extends WidgetType {
  private readonly source: string;
  private readonly display: boolean;

  constructor(source: string, display: boolean) {
    super();
    this.source = source;
    this.display = display;
  }

  override eq(other: Formula): boolean {
    return other.source === this.source && other.display === this.display;
  }

  /**
   * A click puts the cursor in the formula, which is what shows the source,
   * as it does in a table. Inline, with vim on, it puts the cursor beside it.
   */
  override ignoreEvent(): boolean {
    return false;
  }

  toDOM(view: EditorView): HTMLElement {
    // A block's space above and below is padding on the box, for the reason
    // the table's is.
    const box = document.createElement(this.display ? "div" : "span");
    box.className = this.display ? "cm-math-block" : "cm-math";
    box.textContent = this.source;
    void loadKatex().then((katex) => {
      katex.render(this.source, box, {
        displayMode: this.display,
        throwOnError: false,
        errorColor: "var(--color-one-warn)",
      });
      view.requestMeasure();
    });
    return box;
  }
}

/** What a mounted embed has to let go of, keyed by its box. */
interface Held {
  stop: () => void;
  nested: EditorView | null;
}

/**
 * Every embed on the screen, by the element it drew.
 *
 * `destroy` is handed the DOM and not the widget that built it, and one widget
 * can be drawn twice, so the box is the only key that names one mounting.
 */
const held = new WeakMap<HTMLElement, Held>();

/**
 * A read-only view of `text`, configured as the editor it sits in.
 *
 * The same parse and the same rendering the note being edited gets, so an
 * embedded note reads as it would opened. The listings and the source come
 * along so its links are judged against the vault and its own embeds draw,
 * one level deeper.
 */
function nestedView(state: EditorState, text: string, parent: HTMLElement): EditorView {
  const paths = state.facet(vaultPaths);
  const images = state.facet(imagePaths);
  const source = state.facet(embedSource);
  return new EditorView({
    state: EditorState.create({
      doc: text,
      extensions: [
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
        noteLanguage(),
        renderedMarkdown(),
        oneDark,
        EditorView.lineWrapping,
        embedDepth.of(state.facet(embedDepth) + 1),
        paths === null ? [] : vaultPaths.of(paths),
        images === null ? [] : imagePaths.of(images),
        source === null ? [] : embedSource.of(source),
        pdfRenderer.of(state.facet(pdfRenderer)),
      ],
    }),
    parent,
  });
}

/**
 * `![[note]]` and `![[note#heading]]`, the note drawn where it is named.
 *
 * The note is rendered by a view of its own rather than as text in a box, so
 * every construct in it draws the way it would opened, embeds included, until
 * `EMBED_DEPTH` says stop.
 *
 * It follows the note rather than reading it once: a save from another pane
 * lands in the nested view by a replace, and `eq` ignores the text, so the
 * outer editor never remounts the box under it.
 *
 * The listeners are on the box because a widget swallows its events by
 * default, so the editor's own handlers never see a click in here. Following
 * takes ctrl or cmd and a click, or a tap, the way a link does: a plain click
 * on a quoted note is someone reading it.
 */
class Embed extends WidgetType {
  private readonly source: EmbedSource;
  private readonly path: string;
  private readonly heading: string | null;
  /** The target as it reads in a message, `note#heading`. */
  private readonly label: string;
  private readonly depth: number;

  constructor(
    source: EmbedSource,
    path: string,
    heading: string | null,
    label: string,
    depth: number,
  ) {
    super();
    this.source = source;
    this.path = path;
    this.heading = heading;
    this.label = label;
    this.depth = depth;
  }

  override eq(other: Embed): boolean {
    return other.path === this.path && other.heading === this.heading && other.depth === this.depth;
  }

  /** What the box shows of `text`, and the line of the note it starts on. */
  private shown(text: string): { text: string; line: number | undefined } | null {
    if (this.heading === null) return { text: noteBody(text), line: undefined };
    return noteSectionOf(text, this.heading);
  }

  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement("div");
    box.className = "cm-embed";

    let line: number | undefined;
    let tapped = false;
    // Stopped where it follows: a box drawn inside another note's box would
    // hand the event on, and that note would open too. Pointerdown still
    // bubbles, so the outer box's own tap state stays current.
    const follow = (event: Event) => {
      event.stopPropagation();
      this.source.open(this.path, line);
    };
    box.addEventListener("mousedown", (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      follow(event);
    });
    // A tap is a touch that ends in a click. A finger the browser takes for a
    // scroll cancels instead, and must not leave the next click armed.
    box.addEventListener("pointerdown", (event) => {
      tapped = event.pointerType === "touch";
    });
    box.addEventListener("pointercancel", () => {
      tapped = false;
    });
    box.addEventListener("click", (event) => {
      if (tapped) follow(event);
      tapped = false;
    });

    // Held before the watch starts, a source being free to answer inside it.
    const mounted: Held = { stop: () => {}, nested: null };
    held.set(box, mounted);
    mounted.stop = this.source.watch(this.path, (text) => {
      const shown = text === null ? null : this.shown(text);
      line = shown?.line;
      if (shown === null) {
        mounted.nested?.destroy();
        mounted.nested = null;
        box.className = "cm-embed cm-embed-missing";
        box.textContent = `Not found: ${this.label}`;
      } else if (mounted.nested === null) {
        box.className = "cm-embed";
        box.textContent = "";
        mounted.nested = nestedView(view.state, shown.text, box);
      } else {
        const { nested } = mounted;
        nested.dispatch({ changes: { from: 0, to: nested.state.doc.length, insert: shown.text } });
      }
      // The box changed height under a line CodeMirror has already measured,
      // the way a picture does when its bytes land.
      view.requestMeasure();
    });
    return box;
  }

  override destroy(dom: HTMLElement): void {
    const mounted = held.get(dom);
    mounted?.stop();
    mounted?.nested?.destroy();
  }
}

/** What frees each drawn pdf, by its box, for the reason `held` keeps a note's. */
const pdfs = new WeakMap<HTMLElement, () => void>();

/**
 * `![[plan.pdf]]`, the pdf drawn where it is named, or `Not found` for a path
 * of null.
 *
 * Followed the way `Embed` is, ctrl or cmd and a click or a tap, with the same
 * listeners for the same reason: a plain click in here is someone reading.
 * `eq` compares what the source names, so a keystroke elsewhere never reopens
 * the pdf. `page` is the one `#page=3` names, undefined for the first.
 */
class PdfEmbed extends WidgetType {
  private readonly renderer: PdfRenderer;
  private readonly source: EmbedSource;
  private readonly path: string | null;
  private readonly name: string;
  private readonly page: number | undefined;

  constructor(
    renderer: PdfRenderer,
    source: EmbedSource,
    path: string | null,
    name: string,
    page: number | undefined,
  ) {
    super();
    this.renderer = renderer;
    this.source = source;
    this.path = path;
    this.name = name;
    this.page = page;
  }

  override eq(other: PdfEmbed): boolean {
    return other.path === this.path && other.name === this.name && other.page === this.page;
  }

  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement("div");
    const { path } = this;
    if (path === null) {
      box.className = "cm-embed cm-embed-missing";
      box.textContent = `Not found: ${this.name}`;
      return box;
    }
    box.className = "cm-embed cm-embed-pdf";

    let tapped = false;
    // Stopped where it follows: in a note embed the event would bubble on to
    // that note's box, and the note would open beside the pdf.
    const follow = (event: Event) => {
      event.stopPropagation();
      // Its slots are its pages once it lands, and a page past them opens the
      // first, the page drawn at the top. Before then the page goes as written.
      const pages = box.querySelectorAll(".cm-pdf-page").length;
      const { page } = this;
      this.source.open(path, page !== undefined && pages > 0 && page > pages ? undefined : page);
    };
    box.addEventListener("mousedown", (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      follow(event);
    });
    box.addEventListener("pointerdown", (event) => {
      tapped = event.pointerType === "touch";
    });
    box.addEventListener("pointercancel", () => {
      tapped = false;
    });
    box.addEventListener("click", (event) => {
      if (tapped) follow(event);
      tapped = false;
    });

    // The URL `gf` opens a pdf at, and the book pane reads one from.
    const url = `/api/assets/${encodePath(path)}`;
    pdfs.set(
      box,
      showPdf(box, this.renderer, url, this.name, () => view.requestMeasure(), this.page),
    );
    return box;
  }

  override destroy(dom: HTMLElement): void {
    pdfs.get(dom)?.();
  }
}

/**
 * An embed past `EMBED_DEPTH`, drawn as the name it would have shown.
 *
 * Without its own `cm-embed` class, so the chain of boxes counts what was
 * actually drawn and this reads as where it stopped.
 */
class EmbedStub extends WidgetType {
  private readonly label: string;

  constructor(label: string) {
    super();
    this.label = label;
  }

  override eq(other: EmbedStub): boolean {
    return other.label === this.label;
  }

  toDOM(): HTMLElement {
    const box = document.createElement("div");
    box.className = "cm-embed-stub";
    box.textContent = this.label;
    return box;
  }
}

/** A run of a cell's text drawn as one element. */
interface Span {
  text: string;
  /** The class the construct wears, or null for text that carries none. */
  class: string | null;
  /** The picture an `![](path)` or `![[x.png]]` draws, standing in for the text. */
  image?: Pictured;
  /**
   * The address the link around this span opens in a tab, if it opens one.
   * Read here because the block cannot read it back: `posAtDOM` inside a block
   * widget answers the block's own position, not the cell's.
   */
  address?: string;
  /** The note the wikilink this span draws names, as `wikiLinkAt` reads it, for the same reason. */
  target?: string;
}

/**
 * A table, drawn as a table.
 *
 * The cells arrive cut into spans rather than as source, because cutting them
 * is a reading of the syntax tree and a widget has only the DOM. The classes
 * are the ones the inline walk hands out, so a bold cell and a bold word in a
 * paragraph come out the same weight.
 */
class TableGrid extends WidgetType {
  private readonly rows: Span[][][];
  private readonly aligns: Align[];
  /** What `eq` compares, the rows being a fresh array on every build. */
  private readonly key: string;

  constructor(rows: Span[][][], aligns: Align[]) {
    super();
    this.rows = rows;
    this.aligns = aligns;
    this.key = JSON.stringify([rows, aligns]);
  }

  override eq(other: TableGrid): boolean {
    return other.key === this.key;
  }

  /**
   * A click in the table puts the cursor in it, which is what shows the source.
   *
   * The default is to swallow the event, and swallowing it here would leave the
   * mouse no way in. The keys have `w`, a search and a line jump, all of which
   * move by document position; `j` and `k` move by what is on the screen and
   * step over the whole block, which is the fast way past a long table.
   *
   * A wide table's block scrolls sideways with no scrollbar to press on, the
   * stylesheet hiding every one, so no press here is the browser's to keep.
   */
  override ignoreEvent(): boolean {
    return false;
  }

  toDOM(view: EditorView): HTMLElement {
    // A block widget is measured by the box it hands back, and a margin sits
    // outside that box, so the space above and below the table is padding on a
    // wrapper. A margin on the table would leave the gutter counting lines
    // against a height that is short by it.
    const block = document.createElement("div");
    block.className = "cm-table-block";
    // A press in a cell follows a link where it would outside a table (#561): a
    // tap on the link's text or picture, ctrl+click on its text, any click on
    // its picture. `posAtDOM` lands on the block's edge, so the editor's own
    // tap and ctrl+click turn away from a link in a cell, and a press followed
    // here is kept from them.
    let tapped = false;
    // A wikilink is the exception: the editor follows it itself, off the
    // cell's `data-target` (#564), so a tap or ctrl+click on one is left to
    // reach the editor and only kept from opening the table.
    const linked = (event: MouseEvent): boolean =>
      event.target instanceof Element &&
      event.target.closest("[data-target]") !== null &&
      (tapped || event.ctrlKey || event.metaKey);
    // The press's answer, kept for its click: ctrl let go between the two
    // would otherwise open the table under the note just followed.
    let leftToEditor = false;
    const follows = (event: MouseEvent): string | null => {
      const target =
        event.target instanceof Element ? event.target.closest("[data-address]") : null;
      if (!(target instanceof HTMLElement) || target.dataset.address === undefined) return null;
      // A wikilink inside the link wins, as off a table, where the editor
      // reads the wikilink first.
      if (linked(event)) return null;
      const always = tapped || target instanceof HTMLImageElement;
      return always || event.ctrlKey || event.metaKey ? target.dataset.address : null;
    };
    // A finger the browser takes for a scroll cancels instead, and must not
    // leave the next click armed.
    block.addEventListener("pointerdown", (event) => {
      tapped = event.pointerType === "touch";
    });
    block.addEventListener("pointercancel", () => {
      tapped = false;
    });
    // CodeMirror moves the cursor in on a mouse's press, which redraws the
    // table as source and takes this block off the page before the click. A
    // press that follows is kept from it, so the follow happens at the click,
    // where a double-click's second has `detail` 2 and opens no second tab.
    block.addEventListener("mousedown", (event) => {
      // A finger's press would leave the browser to put the caret at the
      // block's edge, which opens the table under the wikilink it follows.
      // Kept from that, it moves no focus either, and the note opens off the
      // focused pane (#361), so this one takes the focus first.
      leftToEditor = linked(event);
      if (tapped && leftToEditor) {
        view.focus();
        event.preventDefault();
        return;
      }
      if (follows(event) === null) return;
      event.preventDefault();
      event.stopPropagation();
    });
    // Anything else opens the table. CodeMirror leaves a touch to the
    // selection the browser makes, and the browser makes none on a picture,
    // so a finger on one would leave the table shut. A mouse got there on its
    // press, and the block is gone by the click.
    block.addEventListener("click", (event) => {
      const address = follows(event);
      const wikilink = leftToEditor || linked(event);
      leftToEditor = false;
      tapped = false;
      if (!block.isConnected || wikilink) return;
      if (address === null) {
        view.dispatch({ selection: { anchor: view.posAtDOM(block) } });
        return;
      }
      event.stopPropagation();
      if (event.detail <= 1) window.open(address, "_blank", "noopener");
    });
    const table = block.appendChild(document.createElement("table"));
    table.className = "cm-table-grid";
    const head = table.createTHead();
    const body = table.createTBody();

    this.rows.forEach((cells, index) => {
      const row = (index === 0 ? head : body).insertRow();
      cells.forEach((spans, column) => {
        const cell = row.appendChild(document.createElement(index === 0 ? "th" : "td"));
        const align = this.aligns[column] ?? "none";
        if (align !== "none") cell.style.textAlign = align;
        for (const span of spans) {
          if (span.image) {
            const image = cell.appendChild(pictureElement(view, span.image));
            if (span.address !== undefined) image.dataset.address = span.address;
            continue;
          }
          if (span.class === null) {
            cell.append(span.text);
            continue;
          }
          const marked = document.createElement("span");
          marked.className = span.class;
          marked.textContent = span.text;
          if (span.address !== undefined) marked.dataset.address = span.address;
          if (span.target !== undefined) marked.dataset.target = span.target;
          cell.append(marked);
        }
      });
    });
    return block;
  }
}

/**
 * A ```` ```mermaid ```` block, drawn as its diagram.
 *
 * Shown as its source while the cursor is in it, by the rule a table follows,
 * and a click puts the cursor there for the reason it does on a table. A
 * diagram mermaid cannot read shows the message and the source rather than a
 * blank, so a typo is something you can see and fix.
 */
class MermaidBlock extends WidgetType {
  private readonly source: string;

  constructor(source: string) {
    super();
    this.source = source;
  }

  override eq(other: MermaidBlock): boolean {
    return other.source === this.source;
  }

  override ignoreEvent(): boolean {
    return false;
  }

  toDOM(view: EditorView): HTMLElement {
    // Padding on a wrapper rather than a margin, for the reason `TableGrid`
    // gives.
    const block = document.createElement("div");
    block.className = "cm-mermaid-block";
    const known = drawnMermaid(this.source);
    if (known !== undefined) {
      fillDiagram(block, known, this.source);
      return block;
    }
    // The svg lands after CodeMirror has measured the empty box, so the
    // measurement is asked for again, as a picture's load does.
    void drawMermaid(this.source).then((drawing) => {
      fillDiagram(block, drawing, this.source);
      view.requestMeasure();
    });
    return block;
  }
}

function fillDiagram(block: HTMLElement, drawing: Drawing, source: string): void {
  if ("svg" in drawing) {
    // Sanitised by mermaid at its strict level, see `mermaid.ts`.
    block.innerHTML = drawing.svg;
    return;
  }
  const message = block.appendChild(document.createElement("div"));
  message.className = "cm-mermaid-error";
  message.textContent = drawing.error;
  const code = block.appendChild(document.createElement("pre"));
  code.className = "cm-mermaid-source";
  code.textContent = source;
}

/** What a construct inside a cell shows and the classes it wears, or null. */
function markedText(state: EditorState, node: SyntaxNode): Span[] | null {
  const whole = state.doc.sliceString(node.from, node.to);
  if (node.name === "Tag") return [{ text: whole, class: "cm-tag" }];
  // Only a picture: a player or a sound control has no business in a cell, so
  // those stay their source, as an address that cannot load does.
  if (node.name === "Image") {
    const drawn = drawnImage(state, node);
    if (drawn?.kind !== "picture") return null;
    const to = spacedAddress(state.doc, node)?.to ?? node.to;
    const text = state.doc.sliceString(node.from, to);
    return [{ text, class: null, image: { source: drawn.source, alt: drawn.alt } }];
  }
  // Only a picture again: a note or a pdf drawn in a cell would be a page
  // inside a table, so those stay their source, as a missing picture does.
  if (node.name === "Embed") {
    const link = node.getChild("WikiLink");
    if (link === null) return null;
    const { name, alias } = splitTarget(state.doc.sliceString(link.from + 2, link.to - 2));
    const image = embeddedPicture(state, name, alias);
    return image === null ? null : [{ text: whole, class: null, image }];
  }
  // The character alone, as off a table: a cell is drawn from its spans, so
  // the backslash a table needs before a bar would otherwise show.
  if (node.name === "Escape") return [{ text: whole.slice(1), class: null }];
  const inline = INLINE[node.name];
  if (!inline && node.name !== "Link") return null;
  // A `[text]` with no `(url)` and no definition stays text, brackets and all:
  // see the walk.
  if (
    node.name === "Link" &&
    node.getChildren("LinkMark").length < 3 &&
    linkAddress(node, state.doc) === null
  ) {
    return null;
  }

  // The first two marks, which is all an inline construct has and, on a link,
  // the `[` and `]` around the text rather than the `(url)` that does not show.
  const marks: SyntaxNode[] = [];
  const name = inline ? inline.mark : "LinkMark";
  for (let child = node.firstChild; child && marks.length < 2; child = child.nextSibling) {
    if (child.name === name) marks.push(child);
  }
  const [open, close] = marks;
  if (!open || !close || open.to >= close.from) return null;

  const className = inline ? inline.class : "cm-link";
  if (node.name === "WikiLink") {
    const text = state.doc.sliceString(open.to, close.from);
    const paths = state.facet(vaultPaths);
    const dead = paths !== null && !wikiLinkLands(text, paths);
    const alias = splitTarget(text).alias;
    // The bar's backslash is the table's, so the target is the one the same
    // link hands on off a table.
    const target = text.replace("\\|", "|").trim();
    return [
      { text: alias ?? text, class: dead ? `${className} cm-wikilink-dead` : className, target },
    ];
  }

  // GFM takes a `\|` in a cell as a bar before it reads the code span, so its
  // backslash goes here too, while a code span keeps every other escape as
  // written. The parser makes no Escape inside a code span to cut on.
  if (node.name === "InlineCode") {
    const text = state.doc.sliceString(open.to, close.from).replaceAll("\\|", "|");
    return [{ text, class: className }];
  }

  // What the marks enclose is cut as a cell is, so a picture inside a link or
  // a bold run is drawn rather than shown as its source. A picture wears no
  // class; the text around it wears this one beside any of its own. Inside a
  // link that opens a tab, the picture and the text both carry its address.
  const address = node.name === "Link" ? urlLinkAt(node, state.doc)?.address : undefined;
  return spansIn(state, node, open.to, close.from).map((span) => ({
    ...span,
    ...(span.image ? {} : { class: span.class ? `${className} ${span.class}` : className }),
    ...(address === undefined ? {} : { address }),
  }));
}

/** The text of `parent` from `from` to `to`, cut at the constructs inside it. */
function spansIn(state: EditorState, parent: SyntaxNode, from: number, to: number): Span[] {
  const spans: Span[] = [];
  let at = from;
  for (let child = parent.firstChild; child; child = child.nextSibling) {
    // The marks of a construct being cut, which sit outside the range, and
    // what a picture's spaced address already took in.
    if (child.from < from || child.to > to || child.from < at) continue;
    const marked = markedText(state, child);
    if (marked === null) continue;
    if (child.from > at) spans.push({ text: state.doc.sliceString(at, child.from), class: null });
    spans.push(...marked);
    at = (child.name === "Image" && spacedAddress(state.doc, child)?.to) || child.to;
  }
  if (at < to) spans.push({ text: state.doc.sliceString(at, to), class: null });
  return spans;
}

/**
 * One row's columns, counted off its walls rather than off its cells.
 *
 * An empty cell has no node, so `| a |  | c |` carries two cells and three
 * columns. The walls are what say which column a cell is in, and the last one
 * closes a column only when the row ends with it.
 */
function rowSpans(state: EditorState, row: SyntaxNode): Span[][] {
  const cells: Span[][] = [];
  let open = false;
  let current: Span[] | null = null;

  for (let child = row.firstChild; child; child = child.nextSibling) {
    if (child.name === "TableCell") {
      current = spansIn(state, child, child.from, child.to);
      continue;
    }
    if (child.name !== "TableDelimiter") continue;
    if (open || current !== null) cells.push(current ?? []);
    open = true;
    current = null;
  }
  if (current !== null) cells.push(current);
  return cells;
}

/**
 * Where the table stops, which is not always where the parser says it does.
 *
 * GFM ends a table at a blank line, so a paragraph written straight under one
 * is parsed as a row of a single cell. A row is a line carrying a `|`, the same
 * reading `tableAt` walks a table by, and the first line without one ends it.
 */
function tableEndsAt(state: EditorState, table: SyntaxNode): number {
  const first = state.doc.lineAt(table.from).number;
  const last = state.doc.lineAt(table.to).number;
  let number = first;
  while (number < last && isRow(state.doc.line(number + 1).text)) number++;
  return state.doc.line(number).to;
}

/** A `Table` node read into the shape the widget draws, up to where it ends. */
function tableGrid(state: EditorState, table: SyntaxNode, end: number): TableGrid {
  const rows: Span[][][] = [];
  let aligns: Align[] = [];

  for (let child = table.firstChild; child; child = child.nextSibling) {
    if (child.from >= end) break;
    // The one delimiter that is a child of the table rather than of a row is
    // the line of dashes, and nothing else says where a column's text sits.
    if (child.name === "TableDelimiter") {
      aligns = alignsOf(state.doc.sliceString(child.from, child.to));
      continue;
    }
    rows.push(rowSpans(state, child));
  }
  return new TableGrid(rows, aligns);
}

/** Flips the fold of the callout whose `>` sits at this position. */
const toggleFold = StateEffect.define<number>();

/**
 * Positions a callout folded shut by its `-` opens for.
 *
 * The search pane marks the line a hit sits on, and a hit inside a shut body
 * would mark a line nobody can see. A click still shuts it again.
 */
export const opensFor = Facet.define<number>();

/**
 * A click on a written title flips the fold, as one on the chevron does.
 *
 * The title is text in the document rather than a widget, so CodeMirror would
 * put the cursor in it, and with vim off that shows the callout's source
 * rather than opening it. The mark carries the callout's `>`. A link in the
 * title is left to do what a click on a link does anywhere else.
 */
function foldingTitle(target: EventTarget | null): Element | null {
  if (!(target instanceof Element) || target.closest(".cm-link, .cm-wikilink")) return null;
  return target.closest("[data-fold]");
}

const foldClicks = EditorView.domEventHandlers({
  mousedown(event) {
    if (foldingTitle(event.target) === null) return false;
    event.preventDefault();
    return true;
  },
  click(event, view) {
    const title = foldingTitle(event.target);
    if (title === null) return false;
    view.dispatch({ effects: toggleFold.of(Number(title.getAttribute("data-fold"))) });
    return true;
  },
});

/**
 * The callouts whose fold a click has flipped from what their sign says.
 *
 * View state and not text: Obsidian folds by click without touching the file,
 * so a click here changes nothing undo could take back. Each is kept by the
 * position of its `>`, mapped through every edit so typing elsewhere leaves
 * the fold as it was.
 */
const folds = StateField.define<readonly number[]>({
  create: () => [],
  update(value, tr) {
    let next = value;
    if (tr.docChanged) {
      next = next.flatMap((at) => {
        const mapped = tr.changes.mapPos(at, 1, MapMode.TrackDel);
        return mapped === null ? [] : [mapped];
      });
    }
    for (const effect of tr.effects) {
      if (!effect.is(toggleFold)) continue;
      const at = effect.value;
      next = next.includes(at) ? next.filter((other) => other !== at) : [...next, at];
    }
    return next;
  },
});

/**
 * Makes `dom` flip the fold of the callout at `from`.
 *
 * The widget's default `ignoreEvent` keeps CodeMirror from handling the press,
 * and the `preventDefault` keeps the browser from putting a caret there. With
 * vim off the editor is always in insert mode, so a cursor landing in the
 * callout would show its source rather than open it.
 */
function flipsFold(dom: HTMLElement, view: EditorView, from: number): void {
  dom.addEventListener("mousedown", (event) => event.preventDefault());
  dom.addEventListener("click", (event) => {
    event.preventDefault();
    view.dispatch({ effects: toggleFold.of(from) });
  });
}

/** The chevron, its glyph in CSS and turned by the class when open. */
function chevron(open: boolean): HTMLElement {
  const span = document.createElement("span");
  span.className = open ? "cm-callout-fold cm-callout-fold-open" : "cm-callout-fold";
  return span;
}

/**
 * What stands in for `> [!type]-`: the icon and, when none is written, the
 * title made from the type, with the chevron after it on a callout that folds.
 *
 * The icon's glyph and colour are in CSS, read off the kind class on the line.
 */
class CalloutHead extends WidgetType {
  private readonly title: string | null;
  /** The callout's `>`, or null for one that does not fold. */
  private readonly fold: number | null;
  private readonly open: boolean;

  constructor(title: string | null, fold: number | null, open: boolean) {
    super();
    this.title = title;
    this.fold = fold;
    this.open = open;
  }

  override eq(other: CalloutHead): boolean {
    return other.title === this.title && other.fold === this.fold && other.open === this.open;
  }

  toDOM(view: EditorView): HTMLElement {
    const head = document.createElement("span");
    head.className = "cm-callout-header";
    head.appendChild(document.createElement("span")).className = "cm-callout-icon";
    if (this.title !== null) {
      const title = head.appendChild(document.createElement("span"));
      title.className = "cm-callout-title";
      title.textContent = this.title;
      // Here rather than at the end of the line: a widget there would sit at
      // the edge of this one's range, and of the folded body's.
      if (this.fold !== null) head.append(chevron(this.open));
    }
    if (this.fold !== null) flipsFold(head, view, this.fold);
    return head;
  }
}

/** The chevron after a written title, which is text and so cannot take the click. */
class FoldToggle extends WidgetType {
  private readonly from: number;
  private readonly open: boolean;

  constructor(from: number, open: boolean) {
    super();
    this.from = from;
    this.open = open;
  }

  override eq(other: FoldToggle): boolean {
    return other.from === this.from && other.open === this.open;
  }

  toDOM(view: EditorView): HTMLElement {
    const toggle = chevron(this.open);
    flipsFold(toggle, view, this.from);
    return toggle;
  }
}

/** A callout the walk found, by line number, for the line pass after it. */
interface Box {
  first: number;
  last: number;
  /** The last line on the screen, the title alone when the body is folded. */
  shown: number;
  kind: string;
  /** Whether it shows its source, the cursor being in it. */
  revealed: boolean;
  /** What the head widget covers, its `>` and `[!type]`, when drawn. */
  head: { from: number; to: number } | null;
}

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

/**
 * Normal and replace mode read; insert and visual mode write.
 *
 * A mode we do not know renders, so a vim submode nobody thought about hides
 * its marks rather than leaking them.
 */
function revealsSource(mode: VimMode): boolean {
  return mode === "insert" || mode === "visual";
}

function isLineRevealed(state: EditorState, line: Line): boolean {
  if (!revealsSource(editingMode(state))) return false;
  return state.selection.ranges.some((range) => range.from <= line.to && range.to >= line.from);
}

/**
 * Whether a construct the cursor is inside shows its source.
 *
 * What the inline constructs go by, rather than the line rule above. A line of
 * prose can carry a dozen of them, and unmasking all twelve to edit one word
 * puts asterisks and tildes across the line you are reading while you write it.
 * The one the cursor is in is the one whose marks are worth seeing.
 */
function isNodeRevealed(state: EditorState, from: number, to: number): boolean {
  if (!revealsSource(editingMode(state))) return false;
  return state.selection.ranges.some((range) => range.from <= to && range.to >= from);
}

/**
 * The mark that takes a link's colour off a `[text]` or `![alt][ref]` no
 * definition names, or null for one with a `(url)` or a definition.
 *
 * Such a one is text, as Obsidian shows it, but the highlighter colours every
 * Link and Image node as a link.
 */
function plainBrackets(doc: Text, node: SyntaxNode): Range<Decoration> | null {
  if (node.getChildren("LinkMark").length > 2 || linkAddress(node, doc) !== null) return null;
  // A heading's colour sits on the same spans as the link's, so the CSS has to
  // be told to give it back. Read off the tree, because a setext heading's line
  // carries no heading class.
  let inHeading = false;
  for (let up = node.parent; up; up = up.parent) {
    if (/^(ATX|Setext)Heading[1-6]$/.test(up.name)) inHeading = true;
  }
  const name = inHeading ? "cm-plain-brackets cm-plain-brackets-heading" : "cm-plain-brackets";
  return Decoration.mark({ class: name }).range(node.from, node.to);
}

function build(state: EditorState): Live {
  const decorations: Range<Decoration>[] = [];
  const hidden: Range<Decoration>[] = [];
  /** Every todo line, gathered as the bullets go by, for the counts below. */
  const placed: Placed[] = [];
  /**
   * How far the table being walked reaches, or -1 outside one.
   *
   * A cell's marks stay on the screen, because a table's columns are lined up
   * by counting characters and hiding two of them shortens the cell by two.
   * The walk is depth-first and in document order, so one number is enough:
   * everything inside the table is entered before anything after it.
   */
  let tableEnd = -1;
  /** How far a table or ruby widget already reaches, the walk going on past it. */
  let drawn = -1;
  /** Every callout, an outer one before those inside it. */
  const callouts: Box[] = [];
  /**
   * Every `>`, hidden and classed after the walk.
   *
   * A line's marks come by before the callout that owns the line is found: in
   * `> > [!tip]` the outer quote's mark is entered ahead of the inner quote,
   * and the parser hangs the marks of later lines under the paragraph inside.
   */
  const quotes: { from: number; to: number; line: Line; revealed: boolean }[] = [];
  /** The `[!type]` of the callout last entered, which the parser reads as a link. */
  let header = { from: -1, to: -1 };
  /** The body of the callout last folded shut, which nothing draws. */
  let folded = { from: -1, to: -1 };
  /** How far a callout showing its source reaches. One inside it shows its own. */
  let sourceTo = -1;

  const hide = (from: number, to: number) => {
    const range = HIDDEN.range(from, to);
    decorations.push(range);
    hidden.push(range);
  };

  /**
   * Hides a line-leading mark and the space that separates it from the text.
   *
   * The space has to go with it. Hiding `#` alone would leave the heading
   * indented by one character against every other line in the note.
   */
  const hideLeader = (from: number, markTo: number, line: Line) => {
    let to = markTo;
    while (to < line.to && state.doc.sliceString(to, to + 1) === " ") to++;
    hide(from, to);
  };

  syntaxTree(state).iterate({
    enter(node) {
      // Inside a table the widget has already drawn: nothing there is on the
      // screen to decorate.
      if (node.to <= drawn) return false;
      if (node.from >= folded.from && node.to <= folded.to) return false;
      if (node.from >= header.from && node.to <= header.to) return false;

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

      // A quote whose first line opens with `[!type]` is a callout, drawn as a
      // box with the type's icon and colour. Read here at the quote rather than
      // at its marks, the first line deciding for every line under it. The
      // walk goes on in, so the title's own constructs and a callout nested
      // inside are decorated as they would be anywhere.
      if (isBlockquote) {
        const mark = node.node.firstChild;
        if (mark?.name !== "QuoteMark") return;
        const line = state.doc.lineAt(node.from);
        let at = mark.to;
        if (state.doc.sliceString(at, at + 1) === " ") at++;
        const callout = parseCallout(state.doc.sliceString(at, line.to));
        if (callout === null) return;
        let last = state.doc.lineAt(node.to);
        if (last.from === node.to && last.number > line.number) {
          last = state.doc.line(last.number - 1);
        }
        header = { from: at, to: at + callout.length };

        // The whole callout at once, as a fenced block is: a box whose title
        // is drawn from text you cannot see is no place to edit that text.
        const revealed = node.from < sourceTo || isNodeRevealed(state, node.from, last.to);
        const box: Box = {
          first: line.number,
          last: last.number,
          shown: last.number,
          kind: callout.kind,
          revealed,
          head: null,
        };
        callouts.push(box);
        if (revealed) {
          sourceTo = Math.max(sourceTo, last.to);
          return;
        }

        const folding = callout.fold !== "";
        const shownAt = state.facet(opensFor).some((at) => at >= node.from && at <= last.to);
        const shut = callout.fold === "-" && !shownAt;
        const open = !shut !== state.field(folds).includes(node.from);
        box.head = { from: node.from, to: header.to };
        const widget = new CalloutHead(
          callout.titled ? null : callout.title,
          folding ? node.from : null,
          open,
        );
        decorations.push(Decoration.replace({ widget }).range(node.from, header.to));
        hidden.push(HIDDEN.range(node.from, header.to));
        if (callout.titled) {
          const end = header.to + callout.title.length;
          // The callout's `>` on a title that folds, for `foldClicks` to read.
          const attributes = folding ? { "data-fold": String(node.from) } : undefined;
          decorations.push(
            Decoration.mark({ class: "cm-callout-title", attributes }).range(header.to, end),
          );
          if (folding) {
            decorations.push(
              Decoration.widget({ widget: new FoldToggle(node.from, open), side: -1 }).range(
                line.to,
              ),
            );
          }
        }

        // Shut, the body falls into the title line, the way CodeMirror's own
        // folding hides a range. `FOLDED` tells `skipHidden` where the cursor
        // goes instead: see there.
        if (folding && !open && last.number > line.number) {
          const body = state.doc.line(line.number + 1);
          decorations.push(HIDDEN.range(line.to, last.to));
          hidden.push(FOLDED.range(line.to, last.to));
          folded = { from: body.from, to: last.to };
          box.shown = line.number;
        }
        return;
      }

      // Coloured and left where it is, like the overdue red below: the hash is
      // part of the tag rather than a mark standing in front of one, so there
      // is nothing here for a revealed line to bring back.
      if (isTag) {
        decorations.push(Decoration.mark({ class: "cm-tag" }).range(node.from, node.to));
        return;
      }

      // Every line of the block, so the run reads as one surface with the code
      // in a monospaced face. The backticks and the language go, the surface
      // saying where the block starts and ends better than they did. The code
      // itself is left alone, whichever parser the language named having
      // already highlighted it.
      if (isFence) {
        // A diagram goes by the table's rule, and for its reasons: see there.
        const info = node.node.getChild("CodeInfo");
        const code = node.node.getChild("CodeText");
        const isMermaid =
          info !== null &&
          code !== null &&
          state.doc.sliceString(info.from, info.to).toLowerCase() === "mermaid";
        if (isMermaid) {
          const inside =
            !state.readOnly &&
            state.selection.ranges.some((range) => range.from <= node.to && range.to >= node.from);
          const whole =
            node.from === state.doc.lineAt(node.from).from &&
            node.to === state.doc.lineAt(node.to).to;
          if (!inside && whole) {
            const widget = new MermaidBlock(state.doc.sliceString(code.from, code.to));
            decorations.push(Decoration.replace({ widget, block: true }).range(node.from, node.to));
            drawn = node.to;
            return false;
          }
        }
        const first = state.doc.lineAt(node.from).number;
        const last = state.doc.lineAt(node.to).number;
        // The cursor anywhere in the block hands the fences back, and a fence
        // line is one the cursor cannot reach, so the whole block is the node
        // this asks about.
        const revealed = isNodeRevealed(state, node.from, node.to);
        // A block with no code between its fences keeps them. Hiding both would
        // leave no line on the screen to put the cursor back on, and the two
        // hidden runs would meet inside the one line break they share.
        const fenced = !revealed && last - first > 1;

        const marks = new Set<number>();
        for (let child = node.node.firstChild; child; child = child.nextSibling) {
          if (child.name === "CodeMark") marks.add(state.doc.lineAt(child.from).number);
        }

        // Where the bottom of the surface hangs. A hidden fence falls into the
        // line of code beside it and CodeMirror draws the pair as one line
        // wearing the upper one's class, so a block of a single line carries
        // both ends on its opening fence.
        let closes = last;
        if (fenced) closes = last - first === 2 ? first : last - 1;

        for (let number = first; number <= last; number++) {
          const line = state.doc.line(number);
          const edge = `${number === first ? " cm-code-open" : ""}${number === closes ? " cm-code-close" : ""}`;
          decorations.push(Decoration.line({ class: `cm-code-block${edge}` }).range(line.from));
          // Hidden with the line break that keeps it off the code: the opening
          // fence takes the one after it and the closing fence the one before,
          // so neither leaves a blank row at the end of the block.
          if (!marks.has(number)) continue;
          // On the screen, so knocked back off the code: the backticks and the
          // language say where the block starts, which is what the surface
          // around them is already saying.
          if (!fenced) {
            decorations.push(Decoration.mark({ class: "cm-code-fence" }).range(line.from, line.to));
            continue;
          }
          if (number === first) hide(line.from, line.to + 1);
          else hide(line.from - 1, line.to);
        }
        return;
      }

      // Drawn as a table, and shown as its source while the cursor is in it.
      // The only construct here that flips a whole block at once: one widget
      // stands in for every line of it, so there is no half of a table to show.
      if (isTable) {
        const end = tableEndsAt(state, node.node);
        const first = state.doc.lineAt(node.from);
        const last = state.doc.lineAt(end);
        // The cursor in it is what shows the source, in any mode, and not the
        // mode alone the way every other construct here works. `j` and `k` step
        // over the whole widget, CodeMirror moving by what is on the screen, so
        // a rule waiting for insert mode would leave the table nothing could
        // open. What does reach in is `w`, a search, a line jump and a click,
        // all of which move by document position.
        //
        // A read-only view has no cursor to go in and a selection sitting at
        // offset zero, so a note that opens with a table would show its pipes.
        const inside =
          !state.readOnly &&
          state.selection.ranges.some((range) => range.from <= end && range.to >= node.from);
        // A block widget has to cover whole lines. A table nested in a list is
        // indented past the start of its first one, and shows its source.
        const whole = node.from === first.from;

        if (!inside && whole) {
          decorations.push(
            Decoration.replace({ widget: tableGrid(state, node.node, end), block: true }).range(
              node.from,
              end,
            ),
          );
          // Not `false`, which would skip the prose the parser swallowed along
          // with the table. The walk goes on into it and `drawn` keeps it out
          // of the rows the widget already stands for.
          drawn = end;
          return;
        }

        // The source, in a face where every character is one width, because the
        // columns are lined up by counting spaces. The walk goes on into the
        // cells and colours them, but `tableEnd` stops it hiding anything
        // there: hiding two marks shortens a cell by two. The head row is the
        // only one the source does not mark.
        tableEnd = end;
        for (let number = first.number; number <= last.number; number++) {
          const at = state.doc.line(number).from;
          const edge = number === first.number ? " cm-table-head" : "";
          decorations.push(Decoration.line({ class: `cm-table${edge}` }).range(at));
        }
        return;
      }

      // A `$$` block, by the table's rule and for the table's reasons: one
      // widget stands for its lines, `j` and `k` step over it, and the cursor
      // in it in any mode shows the source. A read-only view draws it.
      if (isBlockMath) {
        const first = state.doc.lineAt(node.from);
        const end = state.doc.lineAt(node.to).to;
        const inside =
          !state.readOnly &&
          state.selection.ranges.some((range) => range.from <= end && range.to >= node.from);
        if (!inside && node.from === first.from) {
          const source = state.doc.sliceString(node.from + 2, node.to - 2).trim();
          const widget = new Formula(source, true);
          decorations.push(Decoration.replace({ widget, block: true }).range(node.from, end));
          return false;
        }
        // On to the `>` of a block in a quote, which shows its source.
        return;
      }

      const line = state.doc.lineAt(node.from);
      const revealed = isLineRevealed(state, line) || node.from < tableEnd;

      // `\*` is the asterisk, and the backslash is a mark like any other. An
      // Anki card side opening with a fence is written with a backslash before
      // its backticks so it opens none, and should read as the backticks. By
      // the line rule, so the cursor's line and a table's source keep it.
      if (isEscape) {
        if (!revealed) hide(node.from, node.from + 1);
        return;
      }

      // Drawn as the note or the picture it names, by the image's line rule
      // and hidden as the image is, for the same reason. Every way out is
      // `false`: the link inside would otherwise hide its brackets and leave
      // `!note` on the screen, which is neither the source nor the drawing.
      if (isEmbed) {
        if (revealed) return false;
        const link = node.node.getChild("WikiLink");
        if (link === null) return false;
        const { name, heading, alias } = splitTarget(
          state.doc.sliceString(link.from + 2, link.to - 2),
        );

        // Until the listings land the name cannot be found in a folder: on a
        // cold load `![[b]]` would watch the inbox path and call a note in `x/`
        // missing, and `![[shot.png]]` would be taken for a note. The source
        // stays until they do. Only a name with a suffix waits on the images,
        // so a listing of them that never comes leaves the notes drawn.
        const paths = state.facet(vaultPaths);
        const images = state.facet(imagePaths);
        if (paths === null) return false;
        const source = state.facet(embedSource);

        // A pdf is found among the paths a link lands on, which hold the
        // vault's assets beside its notes; the image listing holds none. Ahead
        // of the depth cap, a pdf drawing nothing that could embed it back.
        if (name.toLowerCase().endsWith(".pdf")) {
          if (source === null) return false;
          const found = resolveIn(name, paths);
          const path = found !== null && paths.includes(found) ? found : null;
          const renderer = state.facet(pdfRenderer);
          const widget = new PdfEmbed(renderer, source, path, name, pdfPage(heading));
          decorations.push(Decoration.replace({ widget }).range(node.from, node.to));
          hidden.push(HIDDEN.range(node.from, node.to));
          return false;
        }
        if (images === null && /\.\w+$/.test(name) && !name.endsWith(".md")) return false;

        // An image the vault holds is drawn as one. Anything else is a note, or
        // nothing.
        const picture = embeddedPicture(state, name, alias);

        const label = heading === null ? name : `${name}#${heading}`;
        let widget: WidgetType;
        if (picture !== null) widget = new Picture(picture);
        // A view nobody told how to read the vault shows the source, rather
        // than calling every note it names missing.
        else if (source === null) return false;
        else if (state.facet(embedDepth) >= EMBED_DEPTH) widget = new EmbedStub(label);
        else {
          const path = wikiLinkPath(name, paths);
          widget = new Embed(source, path, heading, label, state.facet(embedDepth));
        }
        decorations.push(Decoration.replace({ widget }).range(node.from, node.to));
        hidden.push(HIDDEN.range(node.from, node.to));
        return false;
      }

      // The line is drawn, so the dashes asking for it go. Like the bullet and
      // unlike the blockquote's bar, the drawing stands in for characters, so
      // it leaves when they come back. `---` under a paragraph is a setext
      // heading rather than a rule, and the parser has already told them apart.
      if (isRule) {
        if (revealed) return;
        decorations.push(Decoration.line({ class: "cm-rule" }).range(line.from));
        hide(line.from, line.to);
        return;
      }

      if (heading) {
        // The size stays put while the marks come and go, so revealing a line
        // does not make it jump.
        decorations.push(Decoration.line({ class: `cm-heading-${heading[1]}` }).range(line.from));
        if (revealed) return;

        const mark = node.node.firstChild;
        if (mark?.name !== "HeaderMark") return;
        hideLeader(mark.from, mark.to, line);
        return;
      }

      // Left for after the walk, when the callouts around the line are known.
      if (isQuote) {
        quotes.push({ from: node.from, to: node.to, line, revealed });
        return;
      }

      // The dot is drawn in CSS, so it has to go the moment the `-` it stands
      // in for comes back, or the line carries two bullets. An ordered list is
      // left alone throughout: its number is content, not decoration.
      if (isBullet) {
        // The state is read off the line rather than off a node: the parser
        // emits `TaskMarker` for `[ ]` and `[x]` and for nothing else, so five
        // of the seven states have no node to hang a rendering on. Reading it
        // through `parseTodo` is also what stops the drawing and the writes
        // disagreeing about what counts as a todo.
        const todo = parseTodo(line.text);
        // `parseTodo`'s own regex on its own mask, so the red cannot drift from
        // what counts as due again (#414) or read one inside a link or code
        // span (#415). The mask keeps the length, so the offsets fit the line.
        const due = todo === null ? null : DUE.exec(masked(line.text));

        // Inside the branch that already parsed the line, so no line is read
        // twice and no second pass over the document is added.
        if (todo !== null) placed.push({ line: line.number, todo });

        // Red on the date itself, so unlike everything below it this stays
        // while the line shows its source: it colours text that is on the
        // screen either way rather than standing in for characters.
        if (due && due[1] !== undefined && due[1] < TODAY) {
          const at = line.from + due.index;
          decorations.push(
            Decoration.mark({ class: "cm-todo-overdue" }).range(at, at + due[0].length),
          );
        }

        if (revealed) return;
        decorations.push(
          Decoration.line({
            class: todo === null ? "cm-bullet" : `cm-todo cm-todo-${todo.state}`,
            attributes: { style: `padding-left: ${BULLET_INDENT * listDepth(node.node)}em` },
          }).range(line.from),
        );
        // From the start of the line, not the mark: the spaces that nest the
        // item go too, their job now done by the padding above. On a todo the
        // box goes with them, the symbol standing in for the whole of it.
        hideLeader(line.from, todo === null ? node.to : node.to + BOX_WIDTH, line);
        return;
      }

      // Drawn rather than hidden, which is what makes this the one construct
      // whose rendering is not the source with its marks taken off. The whole
      // of `![alt](path)` goes and the picture stands where it stood, so the
      // range has to be hidden as well as replaced: the cursor cannot rest
      // inside a widget, and `x` on the first character of one would delete a
      // bracket nobody can see.
      if (isImage) {
        const spaced = spacedAddress(state.doc, node.node);
        // An `![alt][ref]` no definition names is text, as a `[text]` is, the
        // cursor on it or not (#554). Asked after the spaced address, which
        // the parser leaves as such an image.
        const plain = spaced === null ? plainBrackets(state.doc, node.node) : null;
        if (plain !== null) {
          decorations.push(plain);
          return;
        }
        if (revealed) return;
        const media = drawnImage(state, node.node);
        // Neither a video nor an image that can load, drawn as its own source
        // for the reason `drawnImage` gives.
        if (media === null) return;
        // The position the note remembers, so a clip picked up again opens where
        // the pane left it. Read here rather than held, the widget's `eq` being
        // what stops a later position remounting the frame.
        const widget: WidgetType =
          media.kind === "video"
            ? new Player(media.id, watchedAt(state.doc.toString(), media.id))
            : media.kind === "sound"
              ? new Sound(media.source)
              : new Picture(media);
        // A spaced address is text after the node, on the cursor's line with
        // it, so the line rule reveals the two together. `drawn` keeps the
        // walk from hiding a mark inside it, as a ruby's does.
        const end = spaced?.to ?? node.to;
        decorations.push(Decoration.replace({ widget }).range(node.from, end));
        hidden.push(HIDDEN.range(node.from, end));
        if (spaced !== null) drawn = end;
        return;
      }

      // The parser reads each of the four tags as a node of its own, so the
      // ruby is read off the text from its opening one. `drawn` keeps the walk
      // from hiding an escape inside what the widget already stands for.
      if (isRuby) {
        if (revealed) return;
        const found = RUBY.exec(state.doc.sliceString(node.from, line.to));
        if (found === null) return;
        const [whole, base = "", reading = ""] = found;
        const end = node.from + whole.length;
        const widget = new Ruby(unescaped(base), unescaped(reading));
        decorations.push(Decoration.replace({ widget }).range(node.from, end));
        hidden.push(HIDDEN.range(node.from, end));
        drawn = end;
        return;
      }

      // A link and the inline constructs below it are read off the node: the
      // cursor has to be in the one whose marks come back. Everything above is
      // a line construct, whose mark sits at the head of the line and whose two
      // rules therefore say the same thing.
      const inlineRevealed = isNodeRevealed(state, node.from, node.to) || node.from < tableEnd;

      // Drawn in place of `$x$` and hidden as an image is, so the cursor in
      // normal mode steps over the formula rather than onto a hidden `$`.
      if (isInlineMath) {
        if (inlineRevealed) return false;
        const widget = new Formula(state.doc.sliceString(node.from + 1, node.to - 1), false);
        decorations.push(Decoration.replace({ widget }).range(node.from, node.to));
        hidden.push(HIDDEN.range(node.from, node.to));
        return false;
      }

      if (isLink) {
        // `- [/] task` parses its box as a link, brackets and all. The bullet
        // above hides that box and draws a symbol in its place, so a link
        // rendering of the same three characters is only a way for the two to
        // disagree: on a revealed line the box would come back without them.
        // Two characters past the indent is the `- ` in front of every todo.
        const todo = parseTodo(line.text);
        if (todo !== null && node.from === line.from + todo.indent + 2) return;
        // The parser reads any `[text]` with no `(url)` as a link, `[!note]` on
        // a quote line among them. One whose label a definition in the note
        // names is a reference link and draws as the inline link below (#439).
        // Any other is text and keeps its brackets, as Obsidian shows it. Told
        // apart by the `(` mark rather than the URL: `[a]()` is a link to
        // nowhere. The highlighter still colours a Link node as a link, so the
        // mark takes that look back off, the cursor on it or not (#441).
        const plain = plainBrackets(state.doc, node.node);
        if (plain !== null) {
          decorations.push(plain);
          return;
        }

        // A link carries four marks, `[`, `]`, `(` and `)`. The first two
        // bracket the text worth showing; everything from the second to the end
        // of the node is `](url)`, or a reference's `][label]`, and goes.
        const marks: { from: number; to: number }[] = [];
        for (let child = node.node.firstChild; child; child = child.nextSibling) {
          if (child.name === "LinkMark") marks.push({ from: child.from, to: child.to });
        }
        const [open, close] = marks;
        if (!open || !close) return;

        if (open.to < close.from) {
          decorations.push(Decoration.mark({ class: "cm-link" }).range(open.to, close.from));
        }
        if (inlineRevealed) return;
        hide(open.from, open.to);
        hide(close.from, node.to);
        return;
      }

      // The name in front of a relation, hung off the wikilink rather than a
      // second pass over the document: every relation has one by its own
      // grammar, the walk already enters it, and no line is read twice. The
      // `indexOf` is what makes this the relation's own target rather than a
      // second wikilink further along the line, and it is sound because a line
      // carrying a `[[` before the separator is not a relation at all.
      //
      // Nothing is hidden and nothing stands in for the prefix, so the class
      // goes on the cursor's line too, the way `cm-tag` does.
      if (node.name === "WikiLink") {
        const relation = readRelation(line.text);
        if (relation !== null && line.from + line.text.indexOf("[[") === node.from) {
          // The pattern anchors the name near the head of the line, so the
          // first spelling of it is the one in front. Two for the `::`.
          const at = line.from + line.text.indexOf(relation.name);
          decorations.push(
            Decoration.mark({ class: "cm-relation" }).range(at, at + relation.name.length + 2),
          );
        }
      }

      if (!inline) return;

      let open: { from: number; to: number } | null = null;
      let close: { from: number; to: number } | null = null;
      for (let child = node.node.firstChild; child; child = child.nextSibling) {
        if (child.name !== inline.mark) continue;
        open ??= { from: child.from, to: child.to };
        close = { from: child.from, to: child.to };
      }
      // An unclosed delimiter parses as a single mark. Nothing to render.
      if (!open || !close || open.from === close.from) return;

      if (open.to < close.from) {
        // The one construct whose rendering depends on something outside the
        // document: a wikilink to a note the vault does not hold is drawn as
        // the invitation it is rather than as a link that works.
        const target = state.doc.sliceString(open.to, close.from);
        const paths = node.name === "WikiLink" ? state.facet(vaultPaths) : null;
        const dead = paths !== null && !wikiLinkLands(target, paths);
        const className = dead ? `${inline.class} cm-wikilink-dead` : inline.class;

        // `[[note|alias]]` reads as the alias, the name and the bar going with
        // the brackets. The class stays on text in the document, so a click on
        // the alias still finds the link around it.
        const alias = node.name === "WikiLink" ? splitTarget(target).alias : null;
        if (alias !== null && !inlineRevealed) {
          const shown = open.to + target.indexOf("|") + 1;
          decorations.push(Decoration.mark({ class: className }).range(shown, close.from));
          hide(open.from, shown);
          hide(close.from, close.to);
          return;
        }
        decorations.push(Decoration.mark({ class: className }).range(open.to, close.from));
      }
      if (inlineRevealed) return;
      hide(open.from, open.to);
      hide(close.from, close.to);
    },
  });

  /** The callouts a line sits in, outermost first. */
  const around = (number: number) => callouts.filter((c) => c.first <= number && number <= c.last);

  for (const quote of quotes) {
    const boxes = around(quote.line.number);
    // Under a folded body, or under the head widget that stands for the mark.
    if (boxes.some((c) => quote.line.number > c.shown)) continue;
    if (boxes.some((c) => c.head && quote.from >= c.head.from && quote.to <= c.head.to)) continue;
    if (quote.revealed || boxes.some((c) => c.revealed)) continue;
    hideLeader(quote.from, quote.to, quote.line);
  }

  // One line class each, so a callout's line does not wear the quote's bar as
  // well. The bar is drawn in CSS, and unlike the bullet it stands in for
  // nothing, so it can stay while the `>` is back on screen. A callout keeps
  // its box while it shows its source, as a code block keeps its surface.
  const lines = new Set(quotes.map((quote) => quote.line.number));
  for (const box of callouts) {
    for (let number = box.first; number <= box.last; number++) lines.add(number);
  }
  for (const number of lines) {
    const at = state.doc.line(number).from;
    const boxes = around(number);
    const outer = boxes[0];
    const inner = boxes[boxes.length - 1];
    if (outer === undefined || inner === undefined) {
      decorations.push(Decoration.line({ class: "cm-blockquote" }).range(at));
      continue;
    }
    if (boxes.some((c) => number > c.shown)) continue;
    const edge = `${number === outer.first ? " cm-callout-open" : ""}${number === outer.shown ? " cm-callout-close" : ""}${number === inner.first ? " cm-callout-head" : ""}`;
    // A box in a box: the outer one's bar at the edge and the inner one's
    // drawn one step in, the line wearing the inner one's colour.
    const nested = boxes.length > 1;
    decorations.push(
      Decoration.line({
        class: `cm-callout cm-callout-${inner.kind}${edge}${nested ? " cm-callout-nested" : ""}`,
        ...(nested && {
          attributes: {
            style: `--callout-outer: var(--callout-${outer.kind}); --callout-indent: ${boxes.length - 1}em`,
          },
        }),
      }).range(at),
    );
  }

  // After the walk, because what a parent counts is the lines under it, which
  // are read once the whole note has gone by. Pushing out of order is safe:
  // `Decoration.set` sorts. The count stays while a line shows its source, the
  // way the overdue red does, standing in for no character either.
  for (const root of treeOf(placed)) {
    for (const node of [root, ...descendants(root)]) {
      const progress = progressOf(node);
      if (progress === null) continue;
      decorations.push(
        Decoration.widget({
          widget: new Progress(`${progress.closed}/${progress.total}`),
          side: 1,
        }).range(state.doc.line(node.line).to),
      );
    }
  }

  return {
    decorations: Decoration.set(decorations, true),
    hidden: Decoration.set(hidden, true),
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
    if (!tr.docChanged && !tr.selection && !modeChanged && !vaultChanged && !parsed && !flipped) {
      return value;
    }
    return build(tr.state);
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

/**
 * Walks a position off any character that is not on the screen.
 *
 * The shape is `skipAtomicRanges` from @codemirror/view, which does this for
 * `EditorView.atomicRanges`. Vim never consults that facet, so the same walk
 * has to happen here, with one rule tightened. CodeMirror lets the cursor rest
 * on either edge of an atomic range, because both edges paint in the same
 * place. That is fine for motion and wrong for editing: resting on `from` means
 * `x` deletes a character nobody can see. So a position counts as bad when
 * `from <= pos < to`, and only `to` is a landing spot.
 *
 * `direction` flips at most once, from backward to forward, when the hidden run
 * starts a line and there is nothing to its left to retreat to. Each direction
 * moves `pos` monotonically, so the walk cannot cycle.
 *
 * A folded callout's body runs the other way round. It starts at the end of
 * the title, which is where the cursor belongs, and every position after that
 * up to the body's end is bad: the end of its last line paints at the end of
 * the title too, and `dd` there deletes a line nobody can see. Forward lands
 * on the line under the box, backward and at the end of the note on the
 * title. A move up from far along the line under it lands at the body's end,
 * and the general rule would send it back down, the run starting a line.
 */
function skipHidden(start: number, bias: number, hidden: RangeSet<Decoration>, doc: Text): number {
  let pos = start;
  let direction = bias;

  for (;;) {
    let moved = false;
    hidden.between(pos - 1, pos + 1, (from, to, value) => {
      if (value === FOLDED) {
        if (pos <= from || pos > to) return;
        pos = direction < 0 || to === doc.length ? from : to + 1;
        moved = true;
        return;
      }
      if (pos < from || pos >= to) return;
      const lineStart = doc.lineAt(from).from;
      if (direction < 0 && from > lineStart) {
        pos = from - 1;
      } else {
        pos = to;
        direction = 1;
      }
      moved = true;
    });
    if (!moved) return pos;
  }
}

function nudgeOutOfHidden(
  next: EditorSelection,
  previous: EditorSelection,
  hidden: RangeSet<Decoration>,
  doc: Text,
): EditorSelection | null {
  let changed = false;

  const ranges = next.ranges.map((range, index) => {
    // A cursor only. Vim reads a yank by selecting what it covers, `yy` from
    // column zero, and walking that selection's ends out of the marks yanked
    // `## Notes` as `Notes`. A selection in visual mode reveals its marks, so
    // its ends have nothing hidden to land in.
    if (!range.empty) return range;
    const before = previous.ranges[Math.min(index, previous.ranges.length - 1)];
    const bias = before && range.head < before.head ? -1 : 1;
    const head = skipHidden(range.head, bias, hidden, doc);
    if (head === range.head) return range;
    changed = true;
    return EditorSelection.cursor(head);
  });

  return changed ? EditorSelection.create(ranges, next.mainIndex) : null;
}

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
  return [vimModeState(), folds, live, foldClicks, nudgeSelection];
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
  return [vimModeField, folds, live, foldClicks];
}
