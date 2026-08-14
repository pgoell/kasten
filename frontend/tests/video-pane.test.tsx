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

function open(commands = stubCommands()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (playSignal: number) => (
    <QueryClientProvider client={client}>
      <VideoPane note={NOTE} commands={commands} focusSignal={1} playSignal={playSignal} />
    </QueryClientProvider>
  );
  const { container, rerender } = render(view(0));
  return {
    commands,
    pane: container.querySelector("[data-video-pane]") as HTMLElement,
    press: (count: number) => rerender(view(count)),
  };
}

/** What the player says when it starts and stops, which is the only way to know. */
function reports(state: number) {
  window.dispatchEvent(
    new MessageEvent("message", {
      origin: "https://www.youtube.com",
      data: JSON.stringify({ event: "infoDelivery", info: { playerState: state } }),
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
