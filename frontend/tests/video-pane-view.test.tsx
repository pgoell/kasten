import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { VideoPane } from "@/components/video-pane";
import { stubCommands } from "./stub-commands";

// Standing in for the module rather than for `fetch`, the way the exam pane's
// tests do: what the pane owns is what it asks the vault for.
const { fetchNote } = vi.hoisted(() => ({ fetchNote: vi.fn() }));
vi.mock("@/lib/api", () => ({ fetchNote }));

// The transcript is drawn by its own component, tested on its own. Here it is
// a stand-in that hands the pane a `take` spy through the handle, which is the
// one thing this file needs from it.
const { take } = vi.hoisted(() => ({ take: vi.fn(() => true) }));
vi.mock("@/components/video-transcript", async () => {
  const { createElement } = await import("react");
  return {
    VideoTranscript: ({ handle }: { handle: { current: unknown } }) => {
      handle.current = { take };
      return createElement(
        "div",
        { "data-testid": "transcript" },
        createElement("button", { type: "button" }, "a line"),
      );
    },
  };
});
vi.mock("@/components/video-takes", async () => {
  const { createElement } = await import("react");
  return { VideoTakes: () => createElement("div", { "data-testid": "takes" }) };
});

const NOTE = "lit/attention is all you need.md";
const TEXT = "# The talk\n\n[the recording](https://youtu.be/dQw4w9WgXcQ)\n\nNotes below.\n";

beforeEach(() => {
  fetchNote.mockReset();
  fetchNote.mockResolvedValue(TEXT);
  take.mockClear();
});

function renderPane() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onWatched = vi.fn();
  const { container } = render(
    <QueryClientProvider client={client}>
      <VideoPane
        note={NOTE}
        commands={stubCommands()}
        focusSignal={1}
        playSignal={0}
        onWatched={onWatched}
        archive={false}
        onTake={async () => null}
      />
    </QueryClientProvider>,
  );
  return { onWatched, pane: container.querySelector("[data-video-pane]") as HTMLElement };
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

function viewButton() {
  return screen.getByRole("button", { name: "Video view" });
}

describe("the video pane view", () => {
  it("#791 A5 the video view shows the transcript beside the player, with the takes heading", async () => {
    const { pane } = renderPane();
    await screen.findByTitle("video");
    expect(screen.queryByTestId("transcript")).toBeNull();

    fireEvent.click(viewButton());

    expect(viewButton()).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("transcript")).toBeInTheDocument();
    expect(screen.getByText("Taken from this video")).toBeInTheDocument();
    expect(pane).toHaveFocus();

    fireEvent.click(viewButton());

    expect(viewButton()).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByTestId("transcript")).toBeNull();
  });

  it("#791 A5 and I7 the frame is the same element in the view and out of it, and a toggle reports nothing", async () => {
    const { onWatched } = renderPane();
    const before = await screen.findByTitle("video");
    act(() => reports(1, 12));

    fireEvent.click(viewButton());
    expect(screen.getByTitle("video")).toBe(before);
    fireEvent.click(viewButton());
    expect(screen.getByTitle("video")).toBe(before);

    expect(onWatched).not.toHaveBeenCalled();
  });

  it("#791 I7 a key pressed in the transcript reaches the pane's keys", async () => {
    renderPane();
    const { sent } = await spyOnFrame();
    fireEvent.click(viewButton());

    fireEvent.keyDown(within(screen.getByTestId("transcript")).getByRole("button"), { key: "k" });

    expect(sent.mock.calls.map((call) => JSON.parse(String(call[0])).func)).toEqual(["playVideo"]);
  });

  it("#791 A9 y takes the transcript's selection in the view, and does nothing out of it", async () => {
    const { pane } = renderPane();
    await screen.findByTitle("video");

    fireEvent.keyDown(pane, { key: "y" });
    expect(take).not.toHaveBeenCalled();

    fireEvent.click(viewButton());
    fireEvent.keyDown(pane, { key: "y" });
    expect(take).toHaveBeenCalledTimes(1);
  });

  it("#791 A12 guard: a stop after a video view toggle still reports watching once", async () => {
    const { onWatched } = renderPane();
    await screen.findByTitle("video");

    act(() => reports(1, 12));
    fireEvent.click(viewButton());
    act(() => reports(2, 30));

    expect(onWatched.mock.calls).toEqual([["dQw4w9WgXcQ", 30]]);
  });
});
