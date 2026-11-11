import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { VideoPane } from "@/components/video/video-pane";
import { addHighlight } from "@/lib/takes/highlight";
import { hostLeader } from "@/lib/ui/keys/which-key";
import { stubCommands } from "./stub-commands";

// Standing in for the module rather than for `fetch`, the way the exam pane's
// tests do: what the pane owns is what it asks the vault for.
const { fetchNote } = vi.hoisted(() => ({ fetchNote: vi.fn() }));
vi.mock("@/lib/core/api", () => ({ fetchNote }));

const NOTE = "lit/attention is all you need.md";
const TEXT = "# The talk\n\n[the recording](https://youtu.be/dQw4w9WgXcQ)\n\nNotes below.\n";
const TWO_VIDEOS = "[one](https://youtu.be/dQw4w9WgXcQ)\n[two](https://youtu.be/iDulhoQ2pro)\n";

beforeEach(() => {
  fetchNote.mockReset();
  fetchNote.mockResolvedValue(TEXT);
});

afterEach(() => {
  localStorage.removeItem("kasten.vim");
});

type Props = Partial<ComponentProps<typeof VideoPane>>;

/**
 * `cached` puts the note in the query cache before the first render, so the
 * frame is in the first commit: how a pane reopened on a note already read
 * comes up.
 */
function renderPane(props: Props = {}, cached = false, text = TEXT) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (cached) client.setQueryData(["note", NOTE], text);
  const onWatched = vi.fn();
  const view = (next: Props) => (
    <QueryClientProvider client={client}>
      <VideoPane
        note={NOTE}
        commands={stubCommands()}
        focusSignal={1}
        playSignal={0}
        onWatched={onWatched}
        archive={false}
        onTake={async () => null}
        {...next}
      />
    </QueryClientProvider>
  );
  const { container, rerender, unmount } = render(view(props));
  return {
    onWatched,
    unmount,
    pane: container.querySelector("[data-video-pane]") as HTMLElement,
    rerenderWith: (next: Props) => rerender(view({ ...props, ...next })),
  };
}

/** What the player says when it starts and stops, which is the only way to know. */
function reports(state: number, currentTime = 0) {
  window.dispatchEvent(
    new MessageEvent("message", {
      origin: "https://www.youtube.com",
      data: JSON.stringify({ event: "infoDelivery", info: { playerState: state, currentTime } }),
    }),
  );
}

/** One info delivery with whatever `info` holds, for one that names a video. */
function delivers(info: object) {
  window.dispatchEvent(
    new MessageEvent("message", {
      origin: "https://www.youtube.com",
      data: JSON.stringify({ event: "infoDelivery", info }),
    }),
  );
}

/** The frame, with its `postMessage` replaced so the commands sent to it can be read. */
async function spyOnFrame() {
  const frame = (await screen.findByTitle("video")) as HTMLIFrameElement;
  const sent = vi.fn();
  vi.spyOn(frame.contentWindow as Window, "postMessage").mockImplementation(sent);
  return { sent };
}

/** The commands the frame was sent, in order, as the player reads them. */
function commandsOf(sent: ReturnType<typeof vi.fn>) {
  return sent.mock.calls.map((call) => {
    const body = JSON.parse(String(call[0])) as { func: string; args: unknown[] };
    return { func: body.func, args: body.args };
  });
}

/** The shield, found by an assertion first so a missing one fails here and not in a `fireEvent`. */
function shieldOf(pane: HTMLElement): HTMLElement {
  const shield = pane.querySelector("[data-video-shield]");
  expect(shield).not.toBeNull();
  return shield as HTMLElement;
}

describe("the video pane shield and keys", () => {
  it("#791 A4 a click on the shield of a playing video pauses it, keeps the focus on the pane and tells the layout", async () => {
    const onFocus = vi.fn();
    const { pane } = renderPane({ onFocus });
    const { sent } = await spyOnFrame();

    act(() => reports(1, 12));
    fireEvent.click(shieldOf(pane));

    expect(commandsOf(sent)).toEqual([{ func: "pauseVideo", args: [] }]);
    expect(document.activeElement).toBe(pane);
    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  it("#791 A4 a click on the shield of a paused video plays it", async () => {
    const { pane } = renderPane();
    const { sent } = await spyOnFrame();

    fireEvent.click(shieldOf(pane));

    expect(commandsOf(sent)).toEqual([{ func: "playVideo", args: [] }]);
  });

  it("#791 A4 a press on the shield does not move the focus, and the shield is out of the tab order", async () => {
    const { pane } = renderPane();
    await screen.findByTitle("video");

    const shield = shieldOf(pane);
    expect(shield).toHaveAttribute("tabindex", "-1");
    // `fireEvent` answers false when the press was cancelled, which is the
    // `preventDefault` the focus depends on.
    expect(fireEvent.pointerDown(shield)).toBe(false);
  });

  it("#791 A4 the shield says Play while paused and Pause while playing", async () => {
    renderPane();
    await screen.findByTitle("video");

    expect(screen.getByRole("button", { name: "Play" })).toHaveAttribute("data-video-shield");
    act(() => reports(1, 12));
    expect(screen.getByRole("button", { name: "Pause" })).toHaveAttribute("data-video-shield");
  });

  it("#791 A4 the play circle shows while paused and not while playing", async () => {
    const { pane } = renderPane();
    await screen.findByTitle("video");

    const circle = shieldOf(pane).querySelector("[data-paused]") as HTMLElement;
    expect(circle).toHaveAttribute("data-paused", "true");
    expect(circle).toHaveClass("opacity-100");

    act(() => reports(1, 12));
    expect(circle).toHaveAttribute("data-paused", "false");
    expect(circle).toHaveClass("opacity-0");
  });

  it("#791 A4 after a shield click a Space on the pane starts the leader, with vim on", async () => {
    localStorage.setItem("kasten.vim", "on");
    const host = vi.fn();
    const off = hostLeader(host);
    const { pane } = renderPane();
    await screen.findByTitle("video");

    fireEvent.click(shieldOf(pane));
    expect(document.activeElement).toBe(pane);
    fireEvent.keyDown(pane, { key: " " });

    expect(host).toHaveBeenCalledTimes(1);
    off();
  });

  it("#791 A4 after a shield click a Space on the pane starts the leader, with vim off", async () => {
    localStorage.setItem("kasten.vim", "off");
    const host = vi.fn();
    const off = hostLeader(host);
    const { pane } = renderPane();
    await screen.findByTitle("video");

    fireEvent.click(shieldOf(pane));
    expect(document.activeElement).toBe(pane);
    fireEvent.keyDown(pane, { key: " " });

    expect(host).toHaveBeenCalledTimes(1);
    off();
  });

  it("#791 A9 k plays a paused video and pauses a playing one", async () => {
    const { pane } = renderPane();
    const { sent } = await spyOnFrame();

    fireEvent.keyDown(pane, { key: "k" });
    act(() => reports(1, 12));
    fireEvent.keyDown(pane, { key: "k" });

    expect(commandsOf(sent)).toEqual([
      { func: "playVideo", args: [] },
      { func: "pauseVideo", args: [] },
    ]);
  });

  it("#791 A9 j and l seek ten seconds back and on from the second the player is at", async () => {
    const { pane } = renderPane();
    const { sent } = await spyOnFrame();

    act(() => reports(1, 50));
    fireEvent.keyDown(pane, { key: "l" });
    fireEvent.keyDown(pane, { key: "j" });

    // The second moves with each press, so the two presses add up to nothing.
    expect(commandsOf(sent)).toEqual([
      { func: "seekTo", args: [60, true] },
      { func: "seekTo", args: [50, true] },
    ]);
  });

  it("#791 A9 j at the start of the video seeks to 0 and never before", async () => {
    const { pane } = renderPane();
    const { sent } = await spyOnFrame();

    act(() => reports(1, 4));
    fireEvent.keyDown(pane, { key: "j" });

    expect(commandsOf(sent)).toEqual([{ func: "seekTo", args: [0, true] }]);
  });

  it("#791 A9 with a leader pending, k does not play the video", async () => {
    const { pane } = renderPane();
    const { sent } = await spyOnFrame();

    fireEvent.keyDown(pane, { key: " " });
    fireEvent.keyDown(pane, { key: "k" });

    expect(sent).not.toHaveBeenCalled();
  });

  it("#791 A11 a seek signal seeks the player to its seconds, and a raised signal seeks again", async () => {
    const { rerenderWith } = renderPane({ seekSignal: { seconds: 90, signal: 0 } });
    const { sent } = await spyOnFrame();

    rerenderWith({ seekSignal: { seconds: 90, signal: 1 } });
    expect(commandsOf(sent)).toEqual([{ func: "seekTo", args: [90, true] }]);

    rerenderWith({ seekSignal: { seconds: 90, signal: 2 } });
    expect(commandsOf(sent)).toEqual([
      { func: "seekTo", args: [90, true] },
      { func: "seekTo", args: [90, true] },
    ]);
  });

  it("#791 A11 a pane mounted with a raised seek signal does not seek until the signal rises again", async () => {
    // The frame is up in the first commit, so a seek on mount would reach it.
    // Its window is stubbed before the mount so the commands sent there are read.
    const sent = vi.fn();
    const frameWindow = vi
      .spyOn(HTMLIFrameElement.prototype, "contentWindow", "get")
      .mockReturnValue({ postMessage: sent } as unknown as Window);
    const seeks = () => commandsOf(sent).filter((command) => command.func === "seekTo");

    const { rerenderWith } = renderPane({ seekSignal: { seconds: 90, signal: 3 } }, true);
    expect(seeks()).toEqual([]);

    rerenderWith({ seekSignal: { seconds: 90, signal: 4 } });
    expect(seeks()).toEqual([{ func: "seekTo", args: [90, true] }]);
    frameWindow.mockRestore();
  });

  it("#1192 A2 a seek for the linked video while the player is on another loads the linked one at that second", async () => {
    const { rerenderWith } = renderPane({ seekSignal: { seconds: 90, signal: 0 } });
    const { sent } = await spyOnFrame();

    act(() => delivers({ videoData: { video_id: "iDulhoQ2pro" }, playerState: 1 }));
    rerenderWith({ seekSignal: { seconds: 90, signal: 1, id: "dQw4w9WgXcQ" } });
    expect(commandsOf(sent)).toEqual([{ func: "loadVideoById", args: ["dQw4w9WgXcQ", 90] }]);
  });

  it("#1192 I2 a seek for the linked video while the player is on it still seeks", async () => {
    const { rerenderWith } = renderPane({ seekSignal: { seconds: 90, signal: 0 } });
    const { sent } = await spyOnFrame();

    act(() => delivers({ videoData: { video_id: "dQw4w9WgXcQ" }, playerState: 1 }));
    rerenderWith({ seekSignal: { seconds: 90, signal: 1, id: "dQw4w9WgXcQ" } });
    expect(commandsOf(sent)).toEqual([{ func: "seekTo", args: [90, true] }]);
  });

  it("#1192 I3 the linked video loaded back by a seek reports its pause under its id", async () => {
    const { onWatched, rerenderWith } = renderPane({ seekSignal: { seconds: 90, signal: 0 } });
    await spyOnFrame();

    act(() =>
      delivers({ videoData: { video_id: "iDulhoQ2pro" }, playerState: 1, currentTime: 30 }),
    );
    rerenderWith({ seekSignal: { seconds: 90, signal: 1, id: "dQw4w9WgXcQ" } });
    act(() =>
      delivers({ videoData: { video_id: "dQw4w9WgXcQ" }, playerState: 1, currentTime: 91 }),
    );
    act(() => reports(2, 95));
    expect(onWatched.mock.calls).toEqual([["dQw4w9WgXcQ", 95]]);
  });

  it("#1192 I3 an ended linked video loaded back by a seek, closed while it buffers, writes the asked second", async () => {
    const { onWatched, rerenderWith, unmount } = renderPane({
      seekSignal: { seconds: 90, signal: 0 },
    });
    await spyOnFrame();

    act(() =>
      delivers({ videoData: { video_id: "dQw4w9WgXcQ" }, playerState: 1, currentTime: 200 }),
    );
    act(() => reports(0, 212));
    act(() => delivers({ videoData: { video_id: "iDulhoQ2pro" }, playerState: 1, currentTime: 3 }));
    rerenderWith({ seekSignal: { seconds: 90, signal: 1, id: "dQw4w9WgXcQ" } });
    act(() => delivers({ videoData: { video_id: "dQw4w9WgXcQ" }, playerState: 3, currentTime: 0 }));
    unmount();
    expect(onWatched.mock.calls).toEqual([
      ["dQw4w9WgXcQ", 0],
      ["dQw4w9WgXcQ", 90],
    ]);
  });

  it("#791 R8 a seek for another of the note's videos switches to it and opens it at that second", async () => {
    const frameWindow = vi
      .spyOn(HTMLIFrameElement.prototype, "contentWindow", "get")
      .mockReturnValue({ postMessage: vi.fn() } as unknown as Window);

    const { onWatched, rerenderWith } = renderPane(
      { seekSignal: { seconds: 90, signal: 0, id: "iDulhoQ2pro" } },
      true,
      TWO_VIDEOS,
    );
    act(() => reports(1, 12));
    rerenderWith({ seekSignal: { seconds: 90, signal: 1, id: "iDulhoQ2pro" } });

    expect(screen.getByTitle("video")).toHaveAttribute(
      "src",
      "https://www.youtube.com/embed/iDulhoQ2pro?enablejsapi=1&start=90",
    );
    expect(onWatched.mock.calls).toEqual([["dQw4w9WgXcQ", 12]]);
    frameWindow.mockRestore();
  });

  it("#791 R8 an id the note does not link leaves the player alone", async () => {
    const { onWatched, rerenderWith } = renderPane(
      { seekSignal: { seconds: 90, signal: 0, id: "other0000xx" } },
      true,
      TWO_VIDEOS,
    );
    act(() => reports(1, 12));
    rerenderWith({ seekSignal: { seconds: 90, signal: 1, id: "other0000xx" } });

    expect(screen.getByTitle("video")).toHaveAttribute(
      "src",
      "https://www.youtube.com/embed/dQw4w9WgXcQ?enablejsapi=1",
    );
    expect(onWatched).not.toHaveBeenCalled();
  });

  it("#1497 A1 l and j on a suggestion seek it from its own second, down to 0, and never load the linked video", async () => {
    const { pane } = renderPane();
    const { sent } = await spyOnFrame();

    act(() => reports(1, 200));
    act(() =>
      delivers({ videoData: { video_id: "iDulhoQ2pro" }, playerState: 1, currentTime: 12 }),
    );
    for (const key of ["l", "j", "j", "j"]) fireEvent.keyDown(pane, { key });

    expect(commandsOf(sent)).toEqual([
      { func: "seekTo", args: [22, true] },
      { func: "seekTo", args: [12, true] },
      { func: "seekTo", args: [2, true] },
      { func: "seekTo", args: [0, true] },
    ]);
  });

  it("#1497 I1 a second suggestion counts from its own second, not the first one's", async () => {
    const { pane } = renderPane();
    const { sent } = await spyOnFrame();

    act(() => reports(1, 200));
    act(() =>
      delivers({ videoData: { video_id: "iDulhoQ2pro" }, playerState: 1, currentTime: 90 }),
    );
    act(() => delivers({ videoData: { video_id: "aBcDeFgHiJk" }, playerState: 1 }));
    fireEvent.keyDown(pane, { key: "l" });

    expect(commandsOf(sent)).toEqual([{ func: "seekTo", args: [10, true] }]);
  });

  it("#1497 I2 j and l on a suggestion leave the linked video's second and write nothing for it", async () => {
    const { pane, onWatched } = renderPane();
    const { sent } = await spyOnFrame();

    act(() => reports(1, 200));
    act(() =>
      delivers({ videoData: { video_id: "iDulhoQ2pro" }, playerState: 1, currentTime: 30 }),
    );
    fireEvent.keyDown(pane, { key: "l" });
    act(() => delivers({ videoData: { video_id: "dQw4w9WgXcQ" } }));
    fireEvent.keyDown(pane, { key: "l" });

    expect(commandsOf(sent).at(-1)).toEqual({ func: "seekTo", args: [210, true] });
    expect(onWatched).not.toHaveBeenCalled();
  });

  it("#1498 I3 j and l on the ended linked video count from its end second", async () => {
    const { pane } = renderPane();
    const { sent } = await spyOnFrame();

    act(() => reports(1, 200));
    act(() => reports(0, 212));
    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "l" });
    fireEvent.keyDown(pane, { key: "l" });

    expect(commandsOf(sent)).toEqual([
      { func: "seekTo", args: [202, true] },
      { func: "seekTo", args: [212, true] },
      { func: "seekTo", args: [222, true] },
    ]);
  });

  it("#1566 A1 a chapter, a take and a paragraph clicked on a suggestion load the linked video at their second", async () => {
    const { sent } = await marked();
    act(() => reports(1, 200));
    act(() => delivers({ videoData: { video_id: "iDulhoQ2pro" }, playerState: 1 }));
    clickMarks();

    const load = (at: number) => ({ func: "loadVideoById", args: ["dQw4w9WgXcQ", at] });
    expect(commandsOf(sent)).toEqual([load(20), load(40), load(30)]);
  });

  it("#1566 I1 the same clicks on the linked video seek it and load nothing", async () => {
    const { sent } = await marked();
    act(() => reports(1, 200));
    clickMarks();

    const seek = (at: number) => ({ func: "seekTo", args: [at, true] });
    expect(commandsOf(sent)).toEqual([seek(20), seek(40), seek(30)]);
  });

  it("#1566 I2 a click on a suggestion writes nothing until the linked video pauses under its own id", async () => {
    const { onWatched, sent } = await marked();
    act(() => delivers({ videoData: { video_id: "iDulhoQ2pro" }, playerState: 1, currentTime: 9 }));
    fireEvent.click(screen.getByRole("button", { name: "Seek to 00:30" }));
    act(() => reports(2, 12));
    expect(commandsOf(sent)).toEqual([{ func: "loadVideoById", args: ["dQw4w9WgXcQ", 30] }]);
    expect(onWatched).not.toHaveBeenCalled();

    act(() =>
      delivers({ videoData: { video_id: "dQw4w9WgXcQ" }, playerState: 1, currentTime: 31 }),
    );
    act(() => reports(2, 35));
    expect(onWatched.mock.calls).toEqual([["dQw4w9WgXcQ", 35]]);
  });

  it("#1566 I3 an ended linked video loaded back by a click, closed while it buffers, writes the clicked second", async () => {
    const { onWatched, unmount, sent } = await marked();
    act(() => reports(1, 200));
    act(() => reports(0, 212));
    act(() => delivers({ videoData: { video_id: "iDulhoQ2pro" }, playerState: 1, currentTime: 3 }));
    fireEvent.click(screen.getByRole("button", { name: /Part two/ }));
    act(() => delivers({ videoData: { video_id: "dQw4w9WgXcQ" }, playerState: 3, currentTime: 0 }));
    unmount();
    expect(commandsOf(sent)).toEqual([{ func: "loadVideoById", args: ["dQw4w9WgXcQ", 20] }]);
    expect(onWatched.mock.calls).toEqual([
      ["dQw4w9WgXcQ", 0],
      ["dQw4w9WgXcQ", 20],
    ]);
  });

  it("#1566 I4 I6 a click on a suggestion loads the linked video and gives the pane the cursor, with vim on and off", async () => {
    for (const vim of ["on", "off"]) {
      localStorage.setItem("kasten.vim", vim);
      const { pane, sent, unmount } = await marked();
      act(() => delivers({ videoData: { video_id: "iDulhoQ2pro" }, playerState: 1 }));
      fireEvent.click(screen.getByRole("button", { name: /Part two/ }));

      expect(commandsOf(sent)).toEqual([{ func: "loadVideoById", args: ["dQw4w9WgXcQ", 20] }]);
      expect(document.activeElement).toBe(pane);
      unmount();
    }
  });
});

/** A take at 0:40, a chapter at 0:20 and a paragraph at 0:30: one of each control that seeks. */
const MARKED = `${addHighlight(TEXT, { text: "Q.", chapter: "", link: "[00:40](https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=40s)" }, "hl-a1b2c3")}\n## Chapters\n\n[00:20] Part two\n\n## Transcript\n\n[00:30] Words.\n`;

/** The pane in its video view on `MARKED`, where the takes and the transcript show. */
async function marked() {
  fetchNote.mockResolvedValue(MARKED);
  const view = renderPane({}, true, MARKED);
  fireEvent.click(screen.getByRole("button", { name: "Video view" }));
  await screen.findByRole("list", { name: "Transcript" });
  return { ...view, ...(await spyOnFrame()) };
}

function clickMarks() {
  for (const name of [/Part two/, "Seek to 00:40", "Seek to 00:30"]) {
    fireEvent.click(screen.getByRole("button", { name }));
  }
}
