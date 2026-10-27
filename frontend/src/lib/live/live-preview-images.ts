import { syntaxTree } from "@codemirror/language";
import type { EditorState, Text } from "@codemirror/state";
import { Decoration, type EditorView, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { isAudio } from "@/lib/audio";
import { imagePaths, imageSource } from "@/lib/image";
import { linkAddress, unescaped, urlLinkAt } from "@/lib/link-reference";
import { HIDDEN, type Walk } from "@/lib/live/live-preview-hidden";
import { plainBrackets } from "@/lib/live/live-preview-inline";
import { hidePlaceholder, showPlaceholder } from "@/lib/live/live-preview-video";
import { encodePath } from "@/lib/note-path";
import { repeats } from "@/lib/presses";
import { playerUrl, videoId, watchedAt } from "@/lib/video";
import { resolveIn } from "@/lib/wikilink";

/**
 * The picture an `![](path)` names, drawn in place of the text naming it.
 *
 * The one widget here that loads something. A picture arrives with no size and
 * gets one when its bytes land, by which time CodeMirror has measured the line
 * as the height of an empty element, so the load asks for that measurement
 * again. Without it the note below the image sits under it until something else
 * moves the cursor.
 */
export class Picture extends WidgetType {
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
        // Chrome counts any press close to the one before as its second, so
        // the click is a repeat only when the press before it followed the
        // same address (#572).
        if (!repeats(event, link.address)) window.open(link.address, "_blank", "noopener");
      } else {
        view.dispatch({ selection: { anchor: at } });
      }
    });
    return image;
  }
}

/** What a picture is drawn from, the size being one an embed's alias asks for. */
export interface Pictured {
  source: string;
  alt: string;
  width?: number;
  height?: number;
}

/** The `img` a picture is drawn as, on a line of its own or in a table's cell. */
export function pictureElement(view: EditorView, picture: Pictured): HTMLImageElement {
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
export function embeddedPicture(
  state: EditorState,
  name: string,
  alias: string | null,
): Pictured | null {
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
export type Drawn =
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
export function spacedAddress(doc: Text, node: SyntaxNode): { address: string; to: number } | null {
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
export function drawnImage(state: EditorState, node: SyntaxNode): Drawn | null {
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
 * The frame is not built here. CodeMirror drops a widget's DOM when its line
 * scrolls out of the rendered range, and a frame built in it would be destroyed
 * and built again, loading from the start each time. This leaves a sized
 * placeholder, and `live-preview-video.ts` keeps one frame per video in a layer
 * over it, so the player goes on through a scroll.
 *
 * The frame's `enablejsapi=1` comes from `playerUrl`, as the pane's does. The
 * player is a subscriber of its own, so the note's `watching:` moves for it as
 * it moves for the pane's (#953).
 *
 * ponytail: the cursor on the line hands the source back, the way it does for
 * a picture, so clicking into the line hides the video. It keeps playing, out
 * of sight. The upgrade is to keep the widget and reveal the brackets around
 * it, which is a second rendering of the construct rather than the one every
 * other one here uses.
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
   * the URL would call that a different widget and rebuild the placeholder under
   * a video that is playing. Where it opens is read once, when its frame opens,
   * and the player owns where it is after that.
   */
  override eq(other: Player): boolean {
    return other.id === this.id;
  }

  toDOM(view: EditorView): HTMLElement {
    const placeholder = document.createElement("div");
    placeholder.className = "cm-video";
    placeholder.dataset.videoId = this.id;
    showPlaceholder(view, placeholder, this.id, this.url);
    return placeholder;
  }

  override destroy(dom: HTMLElement): void {
    hidePlaceholder(dom);
  }
}

/**
 * Reads an `Image` node into what is drawn for it, or its source.
 *
 * Drawn rather than hidden, which is what makes this the one construct
 * whose rendering is not the source with its marks taken off. The whole
 * of `![alt](path)` goes and the picture stands where it stood, so the
 * range has to be hidden as well as replaced: the cursor cannot rest
 * inside a widget, and `x` on the first character of one would delete a
 * bracket nobody can see.
 */
export function drawImage(walk: Walk, node: SyntaxNode, revealed: boolean): void {
  const { state, decorations, hidden } = walk;
  const spaced = spacedAddress(state.doc, node);
  // An `![alt][ref]` no definition names is text, as a `[text]` is, the
  // cursor on it or not (#554). Asked after the spaced address, which
  // the parser leaves as such an image.
  const plain = spaced === null ? plainBrackets(state.doc, node) : null;
  if (plain !== null) {
    decorations.push(plain);
    return;
  }
  if (revealed) return;
  const media = drawnImage(state, node);
  // Neither a video nor an image that can load, drawn as its own source
  // for the reason `drawnImage` gives.
  if (media === null) return;
  // The position the note remembers, read when the widget is made. That is
  // where a clip's frame opens, the first time it is drawn. After that the
  // frame is the player's own, and a later position written into the note
  // changes nothing on screen: the widget's `eq` ignores it.
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
  if (spaced !== null) walk.drawn = end;
}
