import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { writeWatched } from "@/lib/editor/buffer-writes";
import { drawnImage } from "@/lib/live/live-preview-images";
import { namedVideo, PLAYER } from "@/lib/video/video";
import { applyVideoSettings, learnVideoSettings } from "@/lib/video/video-settings";

/**
 * The players of a note's videos, one iframe each, held outside the text.
 * A frame built in the widget would reload each time its line scrolled away, so it lives in a layer on the scroller.
 */

/** One video in the note: its frame, and what the frame last said. */
interface Player {
  id: string;
  frame: HTMLIFrameElement;
  /** Playing or buffering, by the player's own state. */
  running: boolean;
  /** The last position the player reported above zero. */
  seconds: number;
  /** The video the player last named, undefined until it names one: its own. */
  reported?: string;
}

/** Where a placeholder is on the layer, in pixels. */
interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The videos the note draws as an image, read off the syntax tree. A link the
 * note only names, in its frontmatter or as a plain link, is not drawn and does
 * not keep its player (I5). Null while the tree is still parsing.
 */
function embeddedVideos(state: EditorState): Set<string> | null {
  const tree = ensureSyntaxTree(state, state.doc.length, 1000);
  if (tree === null) return null;
  const ids = new Set<string>();
  tree.iterate({
    enter: (node) => {
      if (node.name !== "Image") return;
      // What the note draws, read the way the drawing reads it, so a spaced
      // address (`![t](https://youtu.be/<id> x)`) keeps its player too.
      const drawn = drawnImage(state, node.node);
      if (drawn?.kind === "video") ids.add(drawn.id);
    },
  });
  return ids;
}

/** A message's JSON, or null for one that is not JSON. */
function parse(data: unknown): unknown {
  if (typeof data !== "string") return null;
  try {
    return JSON.parse(data);
  } catch (_error: unknown) {
    // A message from another script on the page that is not the player's JSON.
    return null;
  }
}

class VideoLayer {
  private readonly view: EditorView;
  private readonly layer: HTMLDivElement;
  private readonly players = new Map<string, Player>();
  /** Each placeholder in the text and the video it stands for. */
  private readonly placeholders = new Map<HTMLElement, string>();
  private destroyed = false;

  constructor(view: EditorView) {
    this.view = view;
    // Appended once and never moved. Inside the scroller it scrolls with the
    // text, so a frame's place on it is the placeholder's place relative to it.
    this.layer = document.createElement("div");
    this.layer.className = "cm-video-layer";
    view.scrollDOM.appendChild(this.layer);
    window.addEventListener("message", this.onMessage);
  }

  update(update: ViewUpdate): void {
    // Only a change to the text can remove a link, and a removed link ends its
    // player (I5). A player whose placeholder is merely off screen keeps going.
    if (update.docChanged && this.players.size > 0) {
      const videos = embeddedVideos(update.state);
      // A tree still parsing names no video it has not read yet, so nothing is
      // ended on its word.
      if (videos !== null) {
        for (const [id, player] of this.players) {
          if (videos.has(id)) continue;
          player.frame.remove();
          this.players.delete(id);
        }
      }
    }
    this.measure();
  }

  destroy(): void {
    this.destroyed = true;
    window.removeEventListener("message", this.onMessage);
    for (const player of this.players.values()) player.frame.remove();
    this.players.clear();
    this.placeholders.clear();
    this.layer.remove();
  }

  /** A placeholder came into the text. The first one for a video opens its frame. */
  register(placeholder: HTMLElement, id: string, url: string): void {
    this.placeholders.set(placeholder, id);
    if (!this.players.has(id)) this.open(id, url);
    this.measure();
  }

  unregister(placeholder: HTMLElement): void {
    this.placeholders.delete(placeholder);
    if (!this.destroyed) this.measure();
  }

  private open(id: string, url: string): void {
    const frame = document.createElement("iframe");
    frame.className = "cm-video-frame";
    frame.src = url;
    frame.title = "video";
    frame.allow = "fullscreen; picture-in-picture";
    frame.allowFullscreen = true;
    // Hidden until the measure places it over its placeholder, so it never shows
    // at the layer's corner.
    frame.style.visibility = "hidden";
    // The player answers nothing until it is told to listen, and a reload of the
    // frame needs telling again, hence on every load.
    frame.addEventListener("load", () => {
      frame.contentWindow?.postMessage(
        JSON.stringify({ event: "listening", channel: "widget" }),
        PLAYER,
      );
    });
    this.layer.appendChild(frame);
    this.players.set(id, { id, frame, running: false, seconds: 0 });
  }

  /**
   * Places each frame over the first connected placeholder of its video.
   * Frames with no placeholder on screen are hidden. Reads run before writes, to avoid layout thrash.
   */
  private measure(): void {
    if (this.destroyed) return;
    this.view.requestMeasure({
      read: (): Map<string, Box> => {
        const layer = this.layer.getBoundingClientRect();
        const boxes = new Map<string, Box>();
        for (const [placeholder, id] of this.placeholders) {
          if (boxes.has(id) || !placeholder.isConnected) continue;
          const rect = placeholder.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          boxes.set(id, {
            left: rect.left - layer.left,
            top: rect.top - layer.top,
            width: rect.width,
            height: rect.height,
          });
        }
        return boxes;
      },
      write: (boxes: Map<string, Box>) => {
        for (const [id, player] of this.players) {
          const box = boxes.get(id);
          const { style } = player.frame;
          if (box === undefined) {
            style.visibility = "hidden";
            continue;
          }
          style.left = `${box.left}px`;
          style.top = `${box.top}px`;
          style.width = `${box.width}px`;
          style.height = `${box.height}px`;
          style.visibility = "visible";
        }
      },
    });
  }

  private command(player: Player, func: string, args: unknown[]): void {
    player.frame.contentWindow?.postMessage(
      JSON.stringify({ event: "command", func, args }),
      PLAYER,
    );
  }

  /**
   * Only the frames this layer holds, and only from the origin the player is
   * served from: a message from the pane's frame or from any other frame on the
   * page moves nothing here (I1).
   */
  private readonly onMessage = (event: MessageEvent): void => {
    if (event.origin !== PLAYER) return;
    const found = [...this.players.values()].find(
      (player) => player.frame.contentWindow === event.source,
    );
    if (found === undefined) return;
    const message = parse(event.data);
    learnVideoSettings(message);
    if (typeof message !== "object" || message === null) return;
    const { event: kind, info } = message as { event?: unknown; info?: unknown };
    if (kind === "onReady") {
      applyVideoSettings((func, args) => this.command(found, func, args));
      return;
    }
    if (kind === "infoDelivery" && typeof info === "object" && info !== null) {
      this.delivered(
        found,
        info as { currentTime?: unknown; playerState?: unknown; videoData?: unknown },
      );
    }
  };

  /** What one info delivery says about a player's position and state. */
  private delivered(
    player: Player,
    info: { currentTime?: unknown; playerState?: unknown; videoData?: unknown },
  ): void {
    const { currentTime, playerState, videoData } = info;
    // A frame moved to another video, such as a suggestion picked on the end
    // screen, reports that video's position. None of it is the link's. The
    // player sends its video once, when it changes, so the id is kept until the
    // next one, not read off each tick.
    const { named, elsewhere } = namedVideo(player.reported, videoData, player.id);
    player.reported = named;
    if (!elsewhere && typeof currentTime === "number" && currentTime > 0) {
      player.seconds = currentTime;
    }
    if (typeof playerState !== "number") return;
    if (playerState === 1 || playerState === 3) {
      player.running = true;
      return;
    }
    // Only the edge out of running writes: a paused player that stays paused
    // writes nothing more, and an ended one writes once (I2).
    if (!player.running) return;
    player.running = false;
    if (elsewhere) return;
    const seconds = playerState === 0 ? 0 : player.seconds;
    if (playerState === 0) player.seconds = 0;
    // A read-only view is a preview of the note: it shows the player and never
    // writes the note it came from (I7).
    if (this.view.state.facet(EditorState.readOnly)) return;
    writeWatched(this.view, { id: player.id, seconds });
  }
}

export const videoLayer = ViewPlugin.fromClass(VideoLayer);

/** The layer each placeholder was registered with, so its destroy can find it. */
const owners = new WeakMap<HTMLElement, VideoLayer>();

/** Registers a placeholder for a video, opening its frame on the first one. */
export function showPlaceholder(
  view: EditorView,
  placeholder: HTMLElement,
  id: string,
  url: string,
): void {
  const layer = view.plugin(videoLayer);
  if (layer === null) return;
  owners.set(placeholder, layer);
  layer.register(placeholder, id, url);
}

/** Forgets a placeholder that has left the text. Its frame keeps playing, hidden. */
export function hidePlaceholder(placeholder: HTMLElement): void {
  owners.get(placeholder)?.unregister(placeholder);
}
