import { EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { type PdfRenderer, pdfRenderer, showPdf } from "@/lib/book/pdf-view";
import { kastenTheme } from "@/lib/editor/editor-theme";
import { EMBED_DEPTH, type EmbedSource, embedDepth, embedSource } from "@/lib/embed";
import { imagePaths } from "@/lib/image";
import { HIDDEN, type Walk } from "@/lib/live/live-preview-hidden";
import { embeddedPicture, Picture } from "@/lib/live/live-preview-images";
import { noteBody } from "@/lib/note-frontmatter";
import { noteLanguage } from "@/lib/note-language";
import { encodePath } from "@/lib/note-path";
import { noteSectionOf } from "@/lib/note-section";
import { pdfPage, resolveIn, splitTarget, vaultPaths, wikiLinkPath } from "@/lib/wikilink";

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
 * `rendering` is passed in, not imported, because live-preview.ts imports this module.
 */
function nestedView(
  state: EditorState,
  text: string,
  parent: HTMLElement,
  rendering: () => Extension,
): EditorView {
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
        rendering(),
        kastenTheme,
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
 * `eq` ignores the text, so a save elsewhere updates the view in place. Listeners sit on the box, since a widget swallows its events.
 */
class Embed extends WidgetType {
  private readonly source: EmbedSource;
  private readonly path: string;
  private readonly heading: string | null;
  /** The target as it reads in a message, `note#heading`. */
  private readonly label: string;
  private readonly depth: number;
  /** The rendering the nested view is built with, which `eq` leaves out. */
  private readonly rendering: () => Extension;

  constructor(
    source: EmbedSource,
    path: string,
    heading: string | null,
    label: string,
    depth: number,
    rendering: () => Extension,
  ) {
    super();
    this.source = source;
    this.path = path;
    this.heading = heading;
    this.label = label;
    this.depth = depth;
    this.rendering = rendering;
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
        mounted.nested = nestedView(view.state, shown.text, box, this.rendering);
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
 * `![[plan.pdf]]`, the pdf drawn where it is named, or `Not found` for a null path.
 * `eq` compares the source, so a keystroke elsewhere never reopens the pdf.
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

/**
 * Drawn as the note or picture it names, hidden as the image is.
 * Every way out is `false`: the link inside would hide its brackets and leave `!note` on screen.
 */
export function drawEmbed(
  walk: Walk,
  node: SyntaxNode,
  revealed: boolean,
  rendering: () => Extension,
): void {
  const { state, decorations, hidden } = walk;
  if (revealed) return;
  const link = node.getChild("WikiLink");
  if (link === null) return;
  const { name, heading, alias } = splitTarget(state.doc.sliceString(link.from + 2, link.to - 2));

  // Until the listings land the name cannot be found in a folder: on a
  // cold load `![[b]]` would watch the inbox path and call a note in `x/`
  // missing, and `![[shot.png]]` would be taken for a note. The source
  // stays until they do. Only a name with a suffix waits on the images,
  // so a listing of them that never comes leaves the notes drawn.
  const paths = state.facet(vaultPaths);
  const images = state.facet(imagePaths);
  if (paths === null) return;
  const source = state.facet(embedSource);

  // A pdf is found among the paths a link lands on, which hold the
  // vault's assets beside its notes; the image listing holds none. Ahead
  // of the depth cap, a pdf drawing nothing that could embed it back.
  if (name.toLowerCase().endsWith(".pdf")) {
    if (source === null) return;
    const found = resolveIn(name, paths);
    const path = found !== null && paths.includes(found) ? found : null;
    const renderer = state.facet(pdfRenderer);
    const widget = new PdfEmbed(renderer, source, path, name, pdfPage(heading));
    decorations.push(Decoration.replace({ widget }).range(node.from, node.to));
    hidden.push(HIDDEN.range(node.from, node.to));
    return;
  }
  if (images === null && /\.\w+$/.test(name) && !name.endsWith(".md")) return;

  // An image the vault holds is drawn as one. Anything else is a note, or
  // nothing.
  const picture = embeddedPicture(state, name, alias);

  const label = heading === null ? name : `${name}#${heading}`;
  let widget: WidgetType;
  if (picture !== null) widget = new Picture(picture);
  // A view nobody told how to read the vault shows the source, rather
  // than calling every note it names missing.
  else if (source === null) return;
  else if (state.facet(embedDepth) >= EMBED_DEPTH) widget = new EmbedStub(label);
  else {
    const path = wikiLinkPath(name, paths);
    widget = new Embed(source, path, heading, label, state.facet(embedDepth), rendering);
  }
  decorations.push(Decoration.replace({ widget }).range(node.from, node.to));
  hidden.push(HIDDEN.range(node.from, node.to));
}
