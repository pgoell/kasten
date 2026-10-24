/**
 * The video pane in real Chromium (#791): the shield and the leader after it, the
 * play circle, the phone's stacked view and its take, two panes side by side, a
 * time in a note reaching its pane, and the transcript following the player.
 *
 * The player is the stand-in in `./video-pane-fixture`: `playerUrl` is `about:blank`
 * and the player's replies are sent as events.
 */

import "./html-take-api";
import { commands as browser, page, userEvent } from "vitest/browser";
import type { Passage } from "@/lib/highlight";
import { type Mounted, panelOf, setUp, tearDown } from "./html-take-fixture";
import { DESKTOP, leader, mount, registerReaderFixture, unmount } from "./reader-fixture";
import {
  circleOf,
  commandsOf,
  deliver,
  frameOf,
  paneButton,
  paneOf,
  registerNotes,
  renderPanes,
  SECONDS,
  shieldOf,
  spyFrame,
  TALK,
  TWIN,
  TWIN_VIDEO,
  talkNote,
  VIDEO,
} from "./video-pane-fixture";

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    fetchFiles: vi.fn(),
    fetchNote: vi.fn(),
    saveNote: async (path: string, content: string) => ({ path, content }),
    searchNotes: vi.fn(),
    fetchTodos: vi.fn(),
    fetchImages: async () => [],
    fetchHtml: async () => [],
    fetchAssets: async () => [],
    fetchTags: async () => [],
    fetchTerminals: async () => [],
    fetchVersion: async () => "0.8.0",
    fetchWeather: async () => [],
  };
});

vi.mock("@/lib/trash-api", async (original) => ({
  ...(await original<typeof import("@/lib/trash-api")>()),
  fetchTrash: async () => [],
}));

vi.mock("@/lib/graph-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/graph-api")>()),
  fetchGraph: vi.fn(),
}));

vi.mock("@/lib/video", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/video")>()),
  playerUrl: () => "about:blank",
}));

registerReaderFixture();
registerNotes({ [TALK]: talkNote(VIDEO), [TWIN]: talkNote(TWIN_VIDEO) });

/** The third paragraph's words, the text node after its time button. */
function thirdParagraphText(host: HTMLElement): Text {
  const paragraph = host.querySelectorAll("[aria-label='Transcript'] li p")[2];
  const text = paragraph?.lastChild;
  if (!(text instanceof Text)) throw new Error("no third paragraph");
  return text;
}

describe("the video pane", () => {
  let mounted: Mounted;

  beforeEach(async () => {
    mounted = await setUp();
  });

  afterEach(async () => {
    await tearDown(mounted);
    // This file's own vim cases set it, and the next file in the browser page would read it, so it goes after each case.
    localStorage.removeItem("kasten.vim");
  });

  /** A press on the shield while the player runs, then Space: the leader opens. */
  async function pauseThenLeader(vim: string) {
    localStorage.setItem("kasten.vim", vim);
    renderPanes(mounted, [{ note: TALK }]);
    await expect
      .poll(() => paneOf(mounted.host).querySelector("[data-video-shield]"))
      .not.toBeNull();
    const frame = frameOf(mounted.host);
    deliver({ playerState: 1 });
    const shield = shieldOf(mounted.host);
    await expect.poll(() => shield.getAttribute("aria-label")).toBe("Pause");

    const sent = spyFrame(frame);
    await userEvent.click(shield);

    expect(commandsOf(sent)).toEqual([{ func: "pauseVideo", args: [] }]);
    expect(document.activeElement).toBe(paneOf(mounted.host));
    await userEvent.keyboard(" ");
    await expect.poll(() => panelOf()).not.toBeNull();
  }

  it("#791 A4 a click on the shield pauses a playing video, keeps the focus on the pane, and Space opens the leader with vim on", async () => {
    await pauseThenLeader("true");
  });

  it("#791 A4 a click on the shield pauses a playing video, keeps the focus on the pane, and Space opens the leader with vim off", async () => {
    await pauseThenLeader("false");
  });

  it("#791 A4 the play circle shows while paused and is hidden while the video plays", async () => {
    renderPanes(mounted, [{ note: TALK }]);
    await expect.poll(() => paneOf(mounted.host).querySelector("[data-paused]")).not.toBeNull();
    const dot = circleOf(mounted.host);

    await expect.poll(() => getComputedStyle(dot).opacity).toBe("1");
    deliver({ playerState: 1 });
    await expect.poll(() => getComputedStyle(dot).opacity).toBe("0");
  });

  it("#791 A14 at 390 with touch a tap plays, the video view stacks the transcript under the player, and a take button 44 px tall takes the paragraph's time link", async () => {
    await page.viewport(390, 844);
    await browser.emulateMedia({ touch: true });
    const onTake = vi.fn<(passage: Passage) => Promise<string | null>>(async () => "hl-7f3a2c");
    renderPanes(mounted, [{ note: TALK, onTake }]);
    await expect
      .poll(() => paneOf(mounted.host).querySelector("[data-video-shield]"))
      .not.toBeNull();
    const frame = frameOf(mounted.host);

    const sent = spyFrame(frame);
    await userEvent.click(shieldOf(mounted.host));
    expect(commandsOf(sent)).toEqual([{ func: "playVideo", args: [] }]);

    const pane = paneOf(mounted.host);
    await expect.poll(() => paneButton(pane, "Video view")).toBeDefined();
    await userEvent.click(paneButton(pane, "Video view") as HTMLButtonElement);
    await expect.poll(() => pane.querySelector("[aria-label='Transcript']")).not.toBeNull();
    const list = pane.querySelector<HTMLElement>("[aria-label='Transcript']");
    if (!list) throw new Error("no transcript");
    // Stacked: the transcript list starts below the frame's bottom edge.
    expect(list.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      frame.getBoundingClientRect().bottom,
    );

    // Stacked, the transcript starts below the player and the pane scrolls to it. The
    // button is checked against the pane on screen, so the words are brought up first.
    list.scrollIntoView({ block: "start" });

    // A selection made by script, as a touch drag over the words makes one.
    const range = document.createRange();
    const words = thirdParagraphText(mounted.host);
    range.setStart(words, 0);
    range.setEnd(words, words.length);
    const selection = window.getSelection() as Selection;
    selection.removeAllRanges();
    selection.addRange(range);

    await expect.poll(() => pane.querySelector<HTMLElement>("[data-take]")).not.toBeNull();
    const button = pane.querySelector<HTMLElement>("[data-take]") as HTMLElement;
    expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    const bounds = pane.getBoundingClientRect();
    const box = button.getBoundingClientRect();
    expect(box.left >= bounds.left && box.right <= bounds.right).toBe(true);
    expect(box.top >= bounds.top && box.bottom <= bounds.bottom).toBe(true);

    await userEvent.click(button);
    await expect.poll(() => onTake.mock.calls.length).toBe(1);
    expect(onTake.mock.calls[0]?.[0]).toMatchObject({
      link: `[00:31](https://www.youtube.com/watch?v=${VIDEO}&t=31s)`,
    });
  });

  it("#791 A14 in two panes side by side, k plays only the video of the pane with the focus", async () => {
    renderPanes(mounted, [{ note: TALK, focus: 1 }, { note: TWIN }]);
    await expect.poll(() => mounted.host.querySelectorAll("iframe").length).toBe(2);
    const first = spyFrame(frameOf(mounted.host, 0));
    const second = spyFrame(frameOf(mounted.host, 1));

    await userEvent.keyboard("k");

    expect(commandsOf(first)).toEqual([{ func: "playVideo", args: [] }]);
    expect(commandsOf(second)).toEqual([]);
  });

  it("#791 A6 the video view marks the paragraph at the player's second and scrolls the transcript to it, not the page", async () => {
    // Short enough that the transcript runs past its box, which is the only way it scrolls.
    await page.viewport(1440, 400);
    renderPanes(mounted, [{ note: TALK }]);
    const pane = paneOf(mounted.host);
    await expect.poll(() => paneButton(pane, "Video view")).toBeDefined();
    await userEvent.click(paneButton(pane, "Video view") as HTMLButtonElement);
    await expect.poll(() => pane.querySelector("[aria-label='Transcript']")).not.toBeNull();
    const list = pane.querySelector<HTMLElement>("[aria-label='Transcript']");
    if (!list) throw new Error("no transcript");

    // Down to the last paragraph, so the third is out of the list's view to begin with.
    list.scrollTop = list.scrollHeight;
    await expect.poll(() => list.scrollTop).toBeGreaterThan(0);

    deliver({ currentTime: SECONDS[2] });
    const third = list.children[2] as HTMLElement;
    await expect.poll(() => third.querySelector("p")?.getAttribute("aria-current")).toBe("true");
    await expect
      .poll(() => {
        const row = third.getBoundingClientRect();
        const box = list.getBoundingClientRect();
        return row.top >= box.top && row.bottom <= box.bottom;
      })
      .toBe(true);
    expect(window.scrollY).toBe(0);
  });
});

describe("a time in a note reaches the video pane of that note", () => {
  // Mounted through the route, so the note is the editor's own and the time is a
  // button drawn in its live preview, as a reader sees it.
  let route: Awaited<ReturnType<typeof mount>>;

  beforeEach(async () => {
    route = await mount(
      DESKTOP,
      "light",
      `/?note=${encodeURIComponent(TALK)}`,
      "[data-reader-grid]",
    );
  });

  afterEach(async () => {
    await unmount(route);
  });

  it("#791 A11 I6 a time in a note with no video pane says in the bar that no player is open", async () => {
    await expect.poll(() => route.host.querySelector(".cm-time")).not.toBeNull();
    const time = route.host.querySelector<HTMLElement>('.cm-time[data-seconds="31"]');
    if (!time) throw new Error("no 00:31 time button");
    await userEvent.click(time);

    await expect
      .poll(() => document.body.textContent ?? "")
      .toContain("No player is open for this note: Space g v opens it");
  });

  it("#791 A11 I6 with a video pane for that note, a click on its time seeks that pane's player to 31", async () => {
    await expect.poll(() => route.host.querySelector(".cm-time")).not.toBeNull();
    leader(route.host, [" ", "g", "v"]);
    await expect.poll(() => route.host.querySelector("[data-video-pane] iframe")).not.toBeNull();
    const frame = route.host.querySelector<HTMLIFrameElement>("[data-video-pane] iframe");
    if (!frame) throw new Error("no video frame");
    const sent = spyFrame(frame);

    const time = route.host.querySelector<HTMLElement>('.cm-time[data-seconds="31"]');
    if (!time) throw new Error("no 00:31 time button");
    await userEvent.click(time);

    await expect.poll(() => commandsOf(sent)).toEqual([{ func: "seekTo", args: [31, true] }]);
  });
});
