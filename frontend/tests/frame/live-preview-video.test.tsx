/**
 * A note's video (#953). The player is built once and kept while its link is in
 * the note: scrolled out and back it is the same frame, and what it reports
 * goes into the note's `watching:` field, and only what its own frame reports.
 */

import { history, undo } from "@codemirror/commands";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import type { MockInstance } from "vitest";
import { page, userEvent } from "vitest/browser";
import { kastenTheme } from "@/lib/editor-theme";
import { imagePaths } from "@/lib/image";
import { livePreview } from "@/lib/live-preview";
import { readField } from "@/lib/note-frontmatter";
import { noteLanguage } from "@/lib/note-language";
import { PLAYER, watchedAt } from "@/lib/video";
import { vimKeys } from "@/lib/vim-mode";
import { vaultPaths } from "@/lib/wikilink";
import "@/styles/app.css";
import { shot } from "./shots";

vi.mock("@/lib/video", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/video")>()),
  playerUrl: (id: string, start = 0) => `about:blank#${id}@${Math.floor(start)}`,
}));

const ID = "abcdefghijk";
const LINK = `![](https://www.youtube.com/watch?v=${ID})`;
const SHOTS = import.meta.env.VITE_KASTEN_SHOTS === "1";
const KEY = "kasten.video.1";

/** A note with the video near the top and enough text below to scroll it out. */
const LONG = [
  "---",
  "title: Talk",
  "---",
  "",
  LINK,
  "",
  ...Array.from({ length: 200 }, (_, index) => `filler line ${index}`),
].join("\n");
const NOTE = ["---", "title: Talk", "---", "", LINK, "", "after"].join("\n");
const WATCHED = ["---", "title: Talk", `watching: {${ID}: 30}`, "---", "", LINK, "", "after"].join(
  "\n",
);

let view: EditorView | undefined;

afterEach(() => {
  view?.dom.parentElement?.remove();
  view?.destroy();
  view = undefined;
  localStorage.removeItem(KEY);
});

function mount(
  doc: string,
  options: { vimOn?: boolean; anchor?: number; extra?: Extension[] } = {},
): EditorView {
  // A box of its own height, so the editor scrolls inside it as a pane does.
  const parent = document.body.appendChild(document.createElement("div"));
  parent.style.height = "300px";
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: options.anchor ?? 0 },
      extensions: [
        noteLanguage(),
        kastenTheme,
        history(),
        options.vimOn ? vim() : vimKeys.of(false),
        livePreview(),
        vaultPaths.of([]),
        imagePaths.of([]),
        EditorView.theme({ "&": { height: "100%" } }),
        options.extra ?? [],
      ],
    }),
    parent,
  });
  return view;
}

/** Takes the mounted view down, as leaving the note does. */
function unmount(): void {
  view?.dom.parentElement?.remove();
  view?.destroy();
  view = undefined;
}

/** The note's player frame, which the layer holds once the link is drawn. */
async function frameIn(at: EditorView): Promise<HTMLIFrameElement> {
  await expect.poll(() => at.dom.querySelector('iframe[title="video"]')).not.toBeNull();
  return at.dom.querySelector<HTMLIFrameElement>('iframe[title="video"]') as HTMLIFrameElement;
}

/** Spies on the frame's `postMessage` once its document has settled, so the spy survives. */
async function spied(frame: HTMLIFrameElement): Promise<MockInstance> {
  await expect.poll(() => frame.contentWindow?.document.readyState).toBe("complete");
  return vi.spyOn(frame.contentWindow as Window, "postMessage");
}

/** What a spy saw posted to the player, read back from the JSON it was sent. */
function sentTo(spy: MockInstance): { event?: string; func?: string; args?: unknown[] }[] {
  return spy.mock.calls.map(([data]) => JSON.parse(String(data)));
}

/** The function names sent to the player as commands. */
function commandsOf(spy: MockInstance): string[] {
  return sentTo(spy)
    .filter((message) => message.event === "command")
    .map((message) => String(message.func));
}

/** The arguments of the first command sent with that name. */
function argsOf(spy: MockInstance, func: string): unknown[] | undefined {
  return sentTo(spy).find((message) => message.func === func)?.args;
}

/** A message from a player frame, delivered the way the browser delivers one. */
function send(frame: Window | null, message: object, origin = PLAYER): void {
  window.dispatchEvent(
    new MessageEvent("message", { origin, source: frame, data: JSON.stringify(message) }),
  );
}

function scrollTo(at: EditorView, top: number | "bottom"): void {
  at.scrollDOM.scrollTop = top === "bottom" ? at.scrollDOM.scrollHeight : top;
}

it.each([
  ["A1", "playing", 1, "pauseVideo"],
  ["A2", "paused", 2, "playVideo"],
] as const)(
  "#953 %s a %s video scrolled out and back is the same frame, no reload",
  async (_line, _name, state, forbidden) => {
    const at = mount(LONG);
    const frame = await frameIn(at);
    const url = frame.src;
    const sent = await spied(frame);
    let loads = 0;
    frame.addEventListener("load", () => {
      loads += 1;
    });
    send(frame.contentWindow, { event: "onReady" });
    send(frame.contentWindow, {
      event: "infoDelivery",
      info: { playerState: state, currentTime: 5 },
    });

    scrollTo(at, "bottom");
    await expect.poll(() => at.contentDOM.querySelector(".cm-video")).toBeNull();
    scrollTo(at, 0);
    await expect.poll(() => at.contentDOM.querySelector(".cm-video")).not.toBeNull();

    expect.soft(at.dom.querySelector('iframe[title="video"]')).toBe(frame);
    expect.soft(frame.src).toBe(url);
    expect.soft(loads).toBe(0);
    expect.soft(commandsOf(sent)).not.toContain(forbidden);
  },
);

it("#953 A3 a speed the note's player reports is kept and sent to the next player", async () => {
  const at = mount(NOTE);
  const frame = await frameIn(at);
  send(frame.contentWindow, { event: "onReady" });
  send(frame.contentWindow, { event: "onPlaybackRateChange", info: 1.5 });
  expect(JSON.parse(localStorage.getItem(KEY) ?? "{}").rate).toBe(1.5);

  unmount();
  const next = mount(NOTE);
  const again = await frameIn(next);
  const sent = await spied(again);
  send(again.contentWindow, { event: "onReady" });
  await expect.poll(() => commandsOf(sent)).toContain("setPlaybackRate");
  expect(argsOf(sent, "setPlaybackRate")).toEqual([1.5]);
});

it("#953 A5 the note's player writes where it paused, and reopening starts there at the kept speed", async () => {
  const at = mount(NOTE);
  const frame = await frameIn(at);
  send(frame.contentWindow, { event: "onReady" });
  send(frame.contentWindow, { event: "infoDelivery", info: { playerState: 1, currentTime: 90 } });
  send(frame.contentWindow, { event: "infoDelivery", info: { playerState: 2, currentTime: 95 } });
  expect(watchedAt(at.state.doc.toString(), ID)).toBe(95);

  const doc = at.state.doc.toString();
  unmount();
  localStorage.setItem(KEY, JSON.stringify({ rate: 1.5 }));
  const next = mount(doc);
  const again = await frameIn(next);
  expect(again.src.endsWith("@95")).toBe(true);
  const sent = await spied(again);
  send(again.contentWindow, { event: "onReady" });
  await expect.poll(() => argsOf(sent, "setPlaybackRate")).toEqual([1.5]);
});

it("#953 A5 a pause on another video the frame moved to writes nothing under the link's id", async () => {
  const at = mount(NOTE);
  const frame = await frameIn(at);
  send(frame.contentWindow, { event: "infoDelivery", info: { playerState: 1, currentTime: 30 } });
  send(frame.contentWindow, { event: "infoDelivery", info: { playerState: 2, currentTime: 40 } });
  expect.soft(watchedAt(at.state.doc.toString(), ID)).toBe(40);

  // The frame moved on to a suggested video. YouTube names the video once, when
  // it changes, and the ticks and the pause after that carry no video at all.
  const other = "zyxwvutsrqp";
  send(frame.contentWindow, { event: "infoDelivery", info: { videoData: { video_id: other } } });
  send(frame.contentWindow, { event: "infoDelivery", info: { playerState: 1, currentTime: 120 } });
  send(frame.contentWindow, { event: "infoDelivery", info: { playerState: 2, currentTime: 125 } });
  expect(watchedAt(at.state.doc.toString(), ID)).toBe(40);
});

it("#953 A6 the note's player writes the second the pane reads back from the note", async () => {
  const at = mount(NOTE);
  const frame = await frameIn(at);
  send(frame.contentWindow, { event: "infoDelivery", info: { playerState: 1, currentTime: 60 } });
  send(frame.contentWindow, { event: "infoDelivery", info: { playerState: 2, currentTime: 61 } });
  expect(watchedAt(at.state.doc.toString(), ID)).toBe(61);
});

it("#953 I1 a delivery from another frame does not move the note's player", async () => {
  const at = mount(NOTE);
  const frame = await frameIn(at);
  send(frame.contentWindow, { event: "infoDelivery", info: { playerState: 1, currentTime: 10 } });
  send(frame.contentWindow, { event: "infoDelivery", info: { playerState: 2, currentTime: 40 } });
  expect(watchedAt(at.state.doc.toString(), ID)).toBe(40);

  const pane = document.body.appendChild(document.createElement("iframe"));
  await expect.poll(() => pane.contentWindow?.document.readyState).toBe("complete");
  send(pane.contentWindow, { event: "infoDelivery", info: { playerState: 1, currentTime: 10 } });
  send(pane.contentWindow, { event: "infoDelivery", info: { playerState: 2, currentTime: 50 } });
  pane.remove();
  expect(watchedAt(at.state.doc.toString(), ID)).toBe(40);
});

it("#953 I2 a video played to its end drops its watching entry", async () => {
  const at = mount(WATCHED);
  const frame = await frameIn(at);
  send(frame.contentWindow, { event: "infoDelivery", info: { playerState: 1, currentTime: 31 } });
  send(frame.contentWindow, { event: "infoDelivery", info: { playerState: 0, currentTime: 0 } });
  expect(watchedAt(at.state.doc.toString(), ID)).toBe(0);
  expect(readField(at.state.doc.toString(), "watching")).not.toContain(ID);
});

it.each([
  ["off", false],
  ["on", true],
] as const)(
  "#953 I3 the position write leaves the cursor and is no undo step, vim %s",
  async (_, vimOn) => {
    const at = mount(NOTE, { vimOn, anchor: NOTE.length });
    at.dispatch({
      changes: { from: NOTE.length, insert: "x" },
      selection: { anchor: NOTE.length + 1 },
      userEvent: "input.type",
    });
    // The write adds a line above the cursor, so the cursor's offset moves with
    // the text. What must hold is that it stays on the same line and column.
    const head = at.state.selection.main.head;
    const line = at.state.doc.lineAt(head);
    const column = head - line.from;
    const frame = await frameIn(at);
    send(frame.contentWindow, { event: "infoDelivery", info: { playerState: 1, currentTime: 10 } });
    send(frame.contentWindow, { event: "infoDelivery", info: { playerState: 2, currentTime: 40 } });
    expect.soft(watchedAt(at.state.doc.toString(), ID)).toBe(40);
    const after = at.state.doc.lineAt(at.state.selection.main.head);
    expect.soft(after.text).toBe(line.text);
    expect.soft(at.state.selection.main.head - after.from).toBe(column);

    if (vimOn) {
      at.focus();
      await userEvent.keyboard("u");
    } else {
      undo(at);
    }
    expect.soft(at.state.doc.toString()).not.toContain("x");
    expect.soft(watchedAt(at.state.doc.toString(), ID)).toBe(40);
  },
);

it("#953 I4 the cursor on the link's line hides the player without ending it", async () => {
  const at = mount(NOTE);
  const frame = await frameIn(at);
  const sent = await spied(frame);
  send(frame.contentWindow, { event: "onReady" });
  send(frame.contentWindow, { event: "infoDelivery", info: { playerState: 1, currentTime: 5 } });

  at.dispatch({ selection: { anchor: NOTE.indexOf("![](") + 2 } });
  await expect.poll(() => at.contentDOM.querySelector(".cm-video")).toBeNull();
  expect.soft(at.dom.querySelector('iframe[title="video"]')).toBe(frame);

  at.dispatch({ selection: { anchor: NOTE.length } });
  await expect.poll(() => at.contentDOM.querySelector(".cm-video")).not.toBeNull();
  expect.soft(at.dom.querySelector('iframe[title="video"]')).toBe(frame);
  expect.soft(commandsOf(sent)).not.toContain("pauseVideo");
});

it("#953 I5 deleting the link from the note ends its player", async () => {
  const at = mount(LONG);
  const frame = await frameIn(at);
  scrollTo(at, "bottom");
  await expect.poll(() => at.contentDOM.querySelector(".cm-video")).toBeNull();
  expect.soft(frame.isConnected).toBe(true);

  // Deleted while the link is off screen: its player ends all the same.
  const start = LONG.indexOf(LINK);
  at.dispatch({ changes: { from: start, to: start + LINK.length } });
  expect(frame.isConnected).toBe(false);
  expect.soft(at.dom.querySelector(".cm-video-frame")).toBeNull();
});

it("#953 I5 a spaced embed keeps its player through an edit elsewhere in the note", async () => {
  const doc = [
    "---",
    "title: Talk",
    "---",
    "",
    `![talk](https://youtu.be/${ID} x)`,
    "",
    ...Array.from({ length: 200 }, (_, index) => `filler line ${index}`),
  ].join("\n");
  const at = mount(doc);
  const frame = await frameIn(at);
  scrollTo(at, "bottom");
  await expect.poll(() => at.contentDOM.querySelector(".cm-video")).toBeNull();
  scrollTo(at, 0);
  await expect.poll(() => at.contentDOM.querySelector(".cm-video")).not.toBeNull();
  expect.soft(at.dom.querySelector('iframe[title="video"]')).toBe(frame);

  at.dispatch({ changes: { from: doc.length, insert: "z" } });
  expect(frame.isConnected).toBe(true);
  expect(at.dom.querySelector('iframe[title="video"]')).toBe(frame);
});

it("#953 I5 deleting the embed ends its player while a plain link to the same video stays", async () => {
  const doc = [
    "---",
    "title: Talk",
    `source: https://youtu.be/${ID}`,
    "---",
    "",
    LINK,
    "",
    `[rec](https://youtu.be/${ID})`,
    "",
    ...Array.from({ length: 200 }, (_, index) => `filler line ${index}`),
  ].join("\n");
  const at = mount(doc);
  const frame = await frameIn(at);
  scrollTo(at, "bottom");
  await expect.poll(() => at.contentDOM.querySelector(".cm-video")).toBeNull();
  expect.soft(frame.isConnected).toBe(true);

  const start = doc.indexOf(LINK);
  at.dispatch({ changes: { from: start, to: start + LINK.length } });
  expect(frame.isConnected).toBe(false);
});

it("#953 I7 a read-only view of the note never writes it", async () => {
  // The positive control: a writable view of the same note does write.
  const writable = mount(NOTE);
  const playing = await frameIn(writable);
  send(playing.contentWindow, { event: "infoDelivery", info: { playerState: 1, currentTime: 10 } });
  send(playing.contentWindow, { event: "infoDelivery", info: { playerState: 2, currentTime: 40 } });
  expect(watchedAt(writable.state.doc.toString(), ID)).toBe(40);

  unmount();
  const at = mount(NOTE, { extra: [EditorState.readOnly.of(true)] });
  const frame = await frameIn(at);
  send(frame.contentWindow, { event: "infoDelivery", info: { playerState: 1, currentTime: 10 } });
  send(frame.contentWindow, { event: "infoDelivery", info: { playerState: 2, currentTime: 60 } });
  expect(at.state.doc.toString()).toBe(NOTE);
});

it("#953 I6 at 414 px the held player takes a tap over its placeholder after a scroll", async () => {
  await page.viewport(414, 844);
  const at = mount(LONG);
  const frame = await frameIn(at);
  scrollTo(at, "bottom");
  await expect.poll(() => at.contentDOM.querySelector(".cm-video")).toBeNull();
  scrollTo(at, 0);
  await expect.poll(() => at.contentDOM.querySelector(".cm-video")).not.toBeNull();
  const placeholder = at.contentDOM.querySelector(".cm-video") as HTMLElement;

  // The tap goes to whatever is at the centre of the placeholder: the held frame.
  const centre = () => {
    const box = placeholder.getBoundingClientRect();
    return document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  };
  await expect.poll(centre).toBe(frame);
  const box = placeholder.getBoundingClientRect();
  const drawn = frame.getBoundingClientRect();
  expect.soft(drawn.left).toBeCloseTo(box.left, 0);
  expect.soft(drawn.top).toBeCloseTo(box.top, 0);
  expect.soft(drawn.width).toBeCloseTo(box.width, 0);
  expect.soft(drawn.height).toBeCloseTo(box.height, 0);
});

it.skipIf(!SHOTS)(
  "#953 I6 shot the player over its placeholder at 414 px",
  async () => {
    await page.viewport(414, 844);
    const at = mount(NOTE);
    const frame = await frameIn(at);
    expect(await shot(frame, "video-953-phone")).toBeGreaterThan(0);
  },
  300_000,
);
