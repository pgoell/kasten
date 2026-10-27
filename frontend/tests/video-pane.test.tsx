import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useLayoutEffect, useState } from "react";
import type { Mock } from "vitest";
import { VideoPane } from "@/components/video-pane";
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

function open(commands = stubCommands(), onWatched = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (playSignal: number, watched = onWatched) => (
    <QueryClientProvider client={client}>
      <VideoPane
        note={NOTE}
        commands={commands}
        focusSignal={1}
        playSignal={playSignal}
        onWatched={watched}
        archive={false}
        onTake={async () => null}
      />
    </QueryClientProvider>
  );
  const { container, rerender, unmount } = render(view(0));
  return {
    commands,
    onWatched,
    pane: container.querySelector("[data-video-pane]") as HTMLElement,
    press: (count: number) => rerender(view(count)),
    // The route's render, which hands the pane a new `onWatched` every time.
    renderAgain: (watched: typeof onWatched) => rerender(view(0, watched)),
    unmount,
  };
}

/**
 * The route as far as the pane can tell: a parent that renders again on every
 * report, the way `setMark` makes it, with a new inline `onWatched` each time.
 *
 * Bounded at five so that a pane which reports on every render shows up as a
 * count and not as a test that never ends.
 */
function Route({ onWatched }: { onWatched: Mock<(id: string, seconds: number) => void> }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  const [, setMark] = useState(0);
  return (
    <QueryClientProvider client={client}>
      <VideoPane
        note={NOTE}
        commands={stubCommands()}
        archive={false}
        onTake={async () => null}
        onWatched={(id, seconds) => {
          onWatched(id, seconds);
          if (onWatched.mock.calls.length < 5) setMark((was) => was + 1);
        }}
      />
    </QueryClientProvider>
  );
}

/**
 * A parent whose layout effect has the player stop when `stop` turns true.
 *
 * A child's layout effects run before its parent's, so the stop lands after the
 * pane has committed the render with the new `onWatched` and before any
 * passive effect of it has run, which is the gap `rerender` cannot reach: it
 * flushes the passive effects before it returns.
 */
function StopOnCommit({
  client,
  onWatched,
  stop,
}: {
  client: QueryClient;
  onWatched: (id: string, seconds: number) => void;
  stop: boolean;
}) {
  useLayoutEffect(() => {
    if (stop) reports(2, 30);
  }, [stop]);
  return (
    <QueryClientProvider client={client}>
      <VideoPane
        note={NOTE}
        commands={stubCommands()}
        archive={false}
        onTake={async () => null}
        onWatched={onWatched}
      />
    </QueryClientProvider>
  );
}

/** What the player says when it starts and stops, which is the only way to know. */
function reports(state: number, currentTime = 0) {
  delivers({ playerState: state, currentTime });
}

/** One info delivery with whatever `info` holds, for a delivery that names a video or carries more than `reports` sends. */
function delivers(info: Record<string, unknown>) {
  window.dispatchEvent(
    new MessageEvent("message", {
      origin: "https://www.youtube.com",
      data: JSON.stringify({ event: "infoDelivery", info }),
    }),
  );
}

/** The command the last `postMessage` carried, or null when it carried none. */
function lastCommand(sent: ReturnType<typeof vi.fn>): string | null {
  const call = sent.mock.calls.at(-1);
  const body: unknown = call === undefined ? null : JSON.parse(String(call[0]));
  return (body as { func?: string } | null)?.func ?? null;
}

describe("the video pane", () => {
  it("plays the video the note links, named after the note", async () => {
    open();

    const frame = await screen.findByTitle("video");
    expect(frame).toHaveAttribute("src", "https://www.youtube.com/embed/dQw4w9WgXcQ?enablejsapi=1");
    expect(screen.getByText("attention is all you need")).toBeInTheDocument();
  });

  it("says so when the note links no video", async () => {
    fetchNote.mockResolvedValue("# A note\n\nNothing to watch here.\n");
    open();

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("No video linked"));
    expect(screen.queryByTitle("video")).toBeNull();
  });

  it("plays and then pauses as the key is pressed from the note", async () => {
    const { press } = open();

    const frame = (await screen.findByTitle("video")) as HTMLIFrameElement;
    const sent = vi.fn();
    // The frame is cross-origin in the browser and same-origin in jsdom, so the
    // window is reachable here and the message is what the test can watch.
    vi.spyOn(frame.contentWindow as Window, "postMessage").mockImplementation(sent);

    press(1);
    expect(lastCommand(sent)).toBe("playVideo");

    // The player answering, which is what a click into it would also produce:
    // the toggle reads the report rather than counting its own presses.
    reports(1);
    press(2);
    expect(lastCommand(sent)).toBe("pauseVideo");

    reports(2);
    press(3);
    expect(lastCommand(sent)).toBe("playVideo");
  });

  it("ignores a message that did not come from the player", async () => {
    const { press } = open();

    const frame = (await screen.findByTitle("video")) as HTMLIFrameElement;
    const sent = vi.fn();
    vi.spyOn(frame.contentWindow as Window, "postMessage").mockImplementation(sent);

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://example.com",
        data: JSON.stringify({ info: { playerState: 1 } }),
      }),
    );

    // Still stopped as far as this pane is concerned, so the key starts it.
    press(1);
    expect(lastCommand(sent)).toBe("playVideo");
  });

  it("reports where the player got to when it stops, and not while it runs", async () => {
    const { onWatched } = open();

    await screen.findByTitle("video");
    reports(1, 12);
    reports(1, 30);
    // Running the whole time, so nothing has been worth writing yet: a report
    // per delivery would restart the wait forever and never write at all.
    expect(onWatched).not.toHaveBeenCalled();

    reports(2, 30);
    expect(onWatched).toHaveBeenCalledWith("dQw4w9WgXcQ", 30);
  });

  it("does not report again when the pane renders with a new onWatched", async () => {
    const { onWatched, renderAgain } = open();
    const later = [vi.fn(), vi.fn(), vi.fn()];

    await screen.findByTitle("video");
    reports(1, 12);
    for (const watched of later) renderAgain(watched);

    // A render is not a stop, and the route renders on every vault write.
    expect([onWatched, ...later].flatMap((watched) => watched.mock.calls)).toEqual([]);
  });

  it("reports a stop once under a route that renders again on each report", async () => {
    const onWatched = vi.fn();
    render(<Route onWatched={onWatched} />);

    await screen.findByTitle("video");
    act(() => reports(1, 12));
    act(() => reports(2, 30));

    expect(onWatched.mock.calls).toEqual([["dQw4w9WgXcQ", 30]]);
  });

  it("reports the old video once on a change of video after a render", async () => {
    fetchNote.mockResolvedValue(
      "[one](https://youtu.be/dQw4w9WgXcQ)\n[two](https://youtu.be/iDulhoQ2pro)\n",
    );
    const { onWatched, pane, renderAgain } = open();
    const later = vi.fn();

    await screen.findByTitle("video");
    reports(1, 12);
    renderAgain(later);
    fireEvent.keyDown(pane, { key: "n" });

    expect([...onWatched.mock.calls, ...later.mock.calls]).toEqual([["dQw4w9WgXcQ", 12]]);
  });

  it("reports once when the pane closes after a render", async () => {
    const { onWatched, renderAgain, unmount } = open();
    const later = vi.fn();

    await screen.findByTitle("video");
    reports(1, 12);
    renderAgain(later);
    unmount();

    expect([...onWatched.mock.calls, ...later.mock.calls]).toEqual([["dQw4w9WgXcQ", 12]]);
  });

  it("reports a stop to the newest onWatched and never to the one before", async () => {
    const { onWatched, renderAgain } = open();
    const later = vi.fn();

    await screen.findByTitle("video");
    reports(1, 12);
    renderAgain(later);
    reports(2, 30);

    expect(later.mock.calls).toEqual([["dQw4w9WgXcQ", 30]]);
    expect(onWatched).not.toHaveBeenCalled();
  });

  it("reports a stop that lands before the passive effects of a render to the new onWatched", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const old = vi.fn();
    const fresh = vi.fn();
    const { rerender } = render(<StopOnCommit client={client} onWatched={old} stop={false} />);

    await screen.findByTitle("video");
    reports(1, 12);
    rerender(<StopOnCommit client={client} onWatched={fresh} stop />);

    expect([old.mock.calls, fresh.mock.calls]).toEqual([[], [["dQw4w9WgXcQ", 30]]]);
  });

  it("opens at the second the note remembers", async () => {
    fetchNote.mockResolvedValue(
      `---\nwatching: {dQw4w9WgXcQ: 312}\n---\n\n[the talk](https://youtu.be/dQw4w9WgXcQ)\n`,
    );
    open();

    expect(await screen.findByTitle("video")).toHaveAttribute(
      "src",
      "https://www.youtube.com/embed/dQw4w9WgXcQ?enablejsapi=1&start=312",
    );
  });

  it("steps through the note's videos and says which one is showing", async () => {
    fetchNote.mockResolvedValue(
      "[one](https://youtu.be/dQw4w9WgXcQ)\n[two](https://youtu.be/iDulhoQ2pro)\n",
    );
    const { pane } = open();

    await screen.findByTitle("video");
    expect(screen.getByText("1/2")).toBeInTheDocument();

    fireEvent.keyDown(pane, { key: "n" });

    expect(await screen.findByTitle("video")).toHaveAttribute(
      "src",
      "https://www.youtube.com/embed/iDulhoQ2pro?enablejsapi=1",
    );
    expect(screen.getByText("2/2")).toBeInTheDocument();

    // Wrapping, so `n` is its own way back on a note holding two.
    fireEvent.keyDown(pane, { key: "n" });
    expect(screen.getByText("1/2")).toBeInTheDocument();
  });

  it("steps to the next video on a tap of the count, which is a phone's `n`", async () => {
    fetchNote.mockResolvedValue(
      "[one](https://youtu.be/dQw4w9WgXcQ)\n[two](https://youtu.be/iDulhoQ2pro)\n",
    );
    const { pane } = open();

    const next = await screen.findByRole("button", { name: "next video" });
    expect(next).toHaveClass("pointer-coarse:min-h-11");
    expect(next).toHaveAttribute("tabindex", "-1");
    fireEvent.click(next);

    expect(await screen.findByTitle("video")).toHaveAttribute(
      "src",
      "https://www.youtube.com/embed/iDulhoQ2pro?enablejsapi=1",
    );
    expect(screen.getByText("2/2")).toBeInTheDocument();
    expect(pane).toHaveFocus();
  });

  it("says nothing about which video on a note holding one", async () => {
    open();

    await screen.findByTitle("video");
    expect(screen.queryByText("1/1")).toBeNull();
  });

  it("takes the focus when the pane is moved to, so the keys land here", () => {
    const { pane } = open();

    expect(document.activeElement).toBe(pane);
  });

  it("closes the pane on the leader then q", () => {
    const { commands, pane } = open();

    fireEvent.keyDown(pane, { key: " " });
    fireEvent.keyDown(pane, { key: "q" });

    expect(commands.closeNote).toHaveBeenCalled();
  });

  it("#1188 A1 the pane writes nothing when the other video pauses", async () => {
    const { onWatched } = open();

    await screen.findByTitle("video");
    delivers({ videoData: { video_id: "iDulhoQ2pro" } });
    reports(1, 12);
    reports(1, 30);
    reports(2, 40);

    expect(onWatched).not.toHaveBeenCalled();
  });

  it("#1188 A2 the linked video pause reports its seconds under its id", async () => {
    const { onWatched } = open();

    await screen.findByTitle("video");
    delivers({ videoData: { video_id: "dQw4w9WgXcQ" } });
    reports(1, 30);
    reports(2, 40);

    expect(onWatched.mock.calls).toEqual([["dQw4w9WgXcQ", 40]]);
  });

  it("#1188 I1 one delivery naming another video and pausing reports nothing", async () => {
    const { onWatched } = open();

    await screen.findByTitle("video");
    reports(1, 12);
    delivers({ videoData: { video_id: "iDulhoQ2pro" }, playerState: 2, currentTime: 30 });

    expect(onWatched).not.toHaveBeenCalled();
  });

  it("#1188 I2 closing the pane while another video plays reports nothing", async () => {
    const { onWatched, unmount } = open();

    await screen.findByTitle("video");
    delivers({ videoData: { video_id: "iDulhoQ2pro" }, playerState: 1, currentTime: 40 });
    unmount();

    expect(onWatched).not.toHaveBeenCalled();
  });

  it("#1188 I3 another video played to its end writes nothing for the linked video", async () => {
    const { onWatched } = open();

    await screen.findByTitle("video");
    delivers({ videoData: { video_id: "iDulhoQ2pro" } });
    reports(1, 30);
    reports(0, 60);

    expect(onWatched).not.toHaveBeenCalled();
  });

  it("#1188 I4 the player back on the linked video reports its own pause again", async () => {
    const { onWatched } = open();

    await screen.findByTitle("video");
    delivers({ videoData: { video_id: "iDulhoQ2pro" }, playerState: 1, currentTime: 100 });
    delivers({ videoData: { video_id: "dQw4w9WgXcQ" }, playerState: 1, currentTime: 50 });
    reports(2, 50);

    expect(onWatched.mock.calls).toEqual([["dQw4w9WgXcQ", 50]]);
  });

  it("#1188 I5 after n the next video pause reports under its own id", async () => {
    fetchNote.mockResolvedValue(
      "[one](https://youtu.be/dQw4w9WgXcQ)\n[two](https://youtu.be/iDulhoQ2pro)\n",
    );
    const { onWatched, pane } = open();

    await screen.findByTitle("video");
    delivers({ videoData: { video_id: "dQw4w9WgXcQ" }, playerState: 1 });
    fireEvent.keyDown(pane, { key: "n" });

    expect(await screen.findByTitle("video")).toHaveAttribute(
      "src",
      "https://www.youtube.com/embed/iDulhoQ2pro?enablejsapi=1",
    );
    reports(1, 25);
    reports(2, 25);

    expect(onWatched.mock.calls).toEqual([["iDulhoQ2pro", 25]]);
  });

  it("#1188 I6 an empty video_id counts as no name", async () => {
    const { onWatched } = open();

    await screen.findByTitle("video");
    delivers({ videoData: { video_id: "" } });
    reports(1, 30);
    reports(2, 40);

    expect(onWatched.mock.calls).toEqual([["dQw4w9WgXcQ", 40]]);
  });
});
