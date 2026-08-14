import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  const view = (playSignal: number) => (
    <QueryClientProvider client={client}>
      <VideoPane
        note={NOTE}
        commands={commands}
        focusSignal={1}
        playSignal={playSignal}
        onWatched={onWatched}
      />
    </QueryClientProvider>
  );
  const { container, rerender } = render(view(0));
  return {
    commands,
    onWatched,
    pane: container.querySelector("[data-video-pane]") as HTMLElement,
    press: (count: number) => rerender(view(count)),
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
});
