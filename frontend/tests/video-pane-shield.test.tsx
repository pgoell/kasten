import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { VideoPane } from "@/components/video-pane";
import { hostLeader } from "@/lib/which-key";
import { stubCommands } from "./stub-commands";

// Standing in for the module rather than for `fetch`, the way the exam pane's
// tests do: what the pane owns is what it asks the vault for.
const { fetchNote } = vi.hoisted(() => ({ fetchNote: vi.fn() }));
vi.mock("@/lib/api", () => ({ fetchNote }));

const NOTE = "lit/attention is all you need.md";
const TEXT = "# The talk\n\n[the recording](https://youtu.be/dQw4w9WgXcQ)\n\nNotes below.\n";

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
function renderPane(props: Props = {}, cached = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (cached) client.setQueryData(["note", NOTE], TEXT);
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
  const { container, rerender } = render(view(props));
  return {
    onWatched,
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

  it("#791 R7 a seek for another of the note's videos leaves this player alone", async () => {
    const sent = vi.fn();
    const frameWindow = vi
      .spyOn(HTMLIFrameElement.prototype, "contentWindow", "get")
      .mockReturnValue({ postMessage: sent } as unknown as Window);
    const seeks = () => commandsOf(sent).filter((command) => command.func === "seekTo");

    const { rerenderWith } = renderPane(
      { seekSignal: { seconds: 90, signal: 0, id: "other0000xx" } },
      true,
    );
    rerenderWith({ seekSignal: { seconds: 90, signal: 1, id: "other0000xx" } });
    expect(seeks()).toEqual([]);

    rerenderWith({ seekSignal: { seconds: 90, signal: 2, id: "dQw4w9WgXcQ" } });
    expect(seeks()).toEqual([{ func: "seekTo", args: [90, true] }]);
    frameWindow.mockRestore();
  });
});
