/**
 * The video pane's frame rig (#791): a talk note with chapters, a transcript and
 * (when asked) a take, the pane mounted alone, and the reads the pane tests share.
 *
 * The stand-in for the player: YouTube cannot load offline, so each test file
 * mocks `playerUrl` to `about:blank`. The frame is then a blank page on this
 * origin, which the pane's commands can be read off by spying on its
 * `postMessage`, and the player's replies are sent as the events it would send.
 *
 * The `vi.mock` calls stay in each test file, because vitest hoists them there.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { flushSync } from "react-dom";
import { vi } from "vitest";
import { VideoPane } from "@/components/video-pane";
import { WhichKey } from "@/components/which-key";
import { fetchNote, NoteMissing } from "@/lib/api";
import type { Passage } from "@/lib/highlight";
import { PLAYER } from "@/lib/video";
import type { Mounted } from "./html-take-fixture";

export const VIDEO = "dQw4w9WgXcQ";
export const TALK = "Talks/Engine.md";
export const TWIN = "Talks/Loom.md";
export const TWIN_VIDEO = "jNQXAC9IVRw";

/** The transcript's paragraphs, each opening at the second in `SECONDS`. */
const STAMPS = ["00:00", "00:14", "00:31", "00:52", "01:18", "01:44", "02:11", "02:40"];
export const SECONDS = [0, 14, 31, 52, 78, 104, 131, 160];
const WORDS = [
  "Good evening. Tonight I want to describe a machine that does not yet exist, and to explain why its designer believed it could weave patterns the way the loom weaves flowers and leaves.",
  "The engine is not a calculator in the ordinary sense. It takes a set of operations and a set of numbers, and it carries out the operations in an order that the cards decide, not the hand that turns the crank.",
  "Consider the question everyone asks first: can the engine think? I will say only that it can do whatever we know how to order it to perform, and that the ordering is the whole of the matter.",
  "A library of cards would let the same mechanism compute tables of sines, of logarithms, and of the motion of the planets, each table checked by the machine against its own rules before it is printed.",
  "There is a danger in admiring such a thing too quickly. The engine will do exactly what it is told, and a careless instruction will be carried out with the same patient accuracy as a wise one.",
  "Let me turn now to the parts. The mill performs the arithmetic, the store keeps the numbers until they are wanted, and the cards carry the orders from one stage of the work to the next.",
  "Some of you will ask about the cost, and some about the uses. Both are fair questions, and I will answer the second first, because the uses are what decide whether the cost was worth paying.",
  "Thank you for your patience. If there are questions about the cards or the mill, I will answer them now, and if there are none, I shall be glad to read the notes once more.",
];

/** A take of the third paragraph, written the way the pane writes one. */
export const TAKE =
  "\n## Highlights\n\n> Consider the question everyone asks first: can the engine think?\n\n[00:31](https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=31s) ^hl-7f3a2c\n";

/** A talk's note: the video it links, its chapters, its transcript, and the takes given. */
export function talkNote(id: string, takes = ""): string {
  const paragraphs = WORDS.flatMap((text, index) => [`[${STAMPS[index]}] ${text}`, ""]);
  return (
    [
      "---",
      "speaker: Ada Lovelace",
      "---",
      "# On the Analytical Engine",
      "",
      `Watch it on [YouTube](https://www.youtube.com/watch?v=${id}).`,
      "",
      "## Chapters",
      "",
      "- [00:00] Opening",
      "- [01:10] The loom",
      "- [02:40] Engine parts",
      "- [04:05] Questions",
      "",
      "## Transcript",
      "",
      "*Captions from the video.*",
      "",
      ...paragraphs,
    ].join("\n") + takes
  );
}

/** The notes the video pane reads, by path, answered ahead of the reader fixture's own. */
export function registerNotes(notes: Record<string, string>) {
  beforeEach(() => {
    const previous = vi.mocked(fetchNote).getMockImplementation();
    vi.mocked(fetchNote).mockImplementation(async (path: string) => {
      const text = notes[path];
      if (text !== undefined) return text;
      if (previous) return previous(path);
      throw new NoteMissing(path);
    });
  });
}

/** One pane over one note. `focus` is the focus signal the layout raises. */
export interface PaneSpec {
  note: string;
  focus?: number;
  onTake?: (passage: Passage) => Promise<string | null>;
}

/** Mounts one video pane per spec side by side, in a viewport-high row, with the leader's panel. */
export function renderPanes(mounted: Mounted, panes: PaneSpec[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  flushSync(() =>
    mounted.root.render(
      <QueryClientProvider client={client}>
        <div className="flex h-dvh flex-row">
          {panes.map((pane) => (
            <div key={pane.note} data-pane className="flex min-w-0 flex-1 flex-col">
              <VideoPane
                note={pane.note}
                commands={mounted.spy}
                focusSignal={pane.focus}
                onWatched={() => {}}
                archive={false}
                onTake={pane.onTake ?? (async () => null)}
                onFocus={() => {}}
              />
            </div>
          ))}
        </div>
        <WhichKey phone={false} />
      </QueryClientProvider>,
    ),
  );
}

/** The video pane on screen, the one with the `data-video-pane` mark. */
export function paneOf(host: HTMLElement, index = 0): HTMLElement {
  const found = host.querySelectorAll<HTMLElement>("[data-video-pane]")[index];
  if (!found) throw new Error(`no video pane ${index}`);
  return found;
}

/** The frame of the pane at `index`. */
export function frameOf(host: HTMLElement, index = 0): HTMLIFrameElement {
  const found = host.querySelectorAll<HTMLIFrameElement>("iframe")[index];
  if (!found) throw new Error(`no frame ${index}`);
  return found;
}

/** The shield over the frame, the button a press plays or pauses through. */
export function shieldOf(host: HTMLElement, index = 0): HTMLElement {
  const found = paneOf(host, index).querySelector<HTMLElement>("[data-video-shield]");
  if (!found) throw new Error(`no shield ${index}`);
  return found;
}

/** The play circle inside the shield, which carries `data-paused`. */
export function circleOf(host: HTMLElement, index = 0): HTMLElement {
  const found = shieldOf(host, index).querySelector<HTMLElement>("[data-paused]");
  if (!found) throw new Error(`no play circle ${index}`);
  return found;
}

/** The button in the pane with exactly `text`, such as Video view. */
export function paneButton(pane: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...pane.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === text,
  );
}

/** Spies on the frame's `postMessage`, the way the pane's commands reach the player. */
export function spyFrame(frame: HTMLIFrameElement) {
  return vi.spyOn(frame.contentWindow as Window, "postMessage");
}

/** The commands a frame was sent, in order, with their arguments. Listening subscriptions are left out. */
export function commandsOf(spy: ReturnType<typeof spyFrame>): { func: string; args: unknown[] }[] {
  return spy.mock.calls.flatMap(([message]) => {
    const sent = JSON.parse(String(message)) as { event?: string; func?: string; args?: unknown[] };
    return sent.event === "command" ? [{ func: sent.func ?? "", args: sent.args ?? [] }] : [];
  });
}

/** The player's report of the video's title and author, which the pane shows in place of the note's name. */
export function titled() {
  deliver({ videoData: { title: "On the Analytical Engine", author: "Computing History" } });
}

/** One delivery from the player, sent the way the player sends one: from its origin, to this window. */
export function deliver(info: Record<string, unknown>) {
  // In act, so the state the pane sets from the reply is flushed as React expects.
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: PLAYER,
        data: JSON.stringify({ event: "infoDelivery", info }),
      }),
    );
  });
}
