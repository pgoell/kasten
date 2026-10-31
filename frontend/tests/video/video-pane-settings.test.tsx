import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { VideoPane } from "@/components/video-pane";
import { stubCommands } from "../stub-commands";

// Standing in for the module rather than for `fetch`, as video-pane.test.tsx does.
const { fetchNote } = vi.hoisted(() => ({ fetchNote: vi.fn() }));
vi.mock("@/lib/api", () => ({ fetchNote }));

const NOTE = "lit/attention is all you need.md";
const ID = "dQw4w9WgXcQ";
const TEXT = "# The talk\n\n[the recording](https://youtu.be/dQw4w9WgXcQ)\n\nNotes below.\n";
const KEPT = "kasten.video.1";

beforeEach(() => {
  fetchNote.mockReset();
  fetchNote.mockResolvedValue(TEXT);
  localStorage.clear();
});

function open(onWatched = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { unmount } = render(
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
  return { onWatched, unmount };
}

/** A delivery from one frame, as the window hears it: `from` is the frame that sent it. */
function hear(from: Window | null, body: unknown) {
  window.dispatchEvent(
    new MessageEvent("message", {
      origin: "https://www.youtube.com",
      source: from,
      data: JSON.stringify(body),
    }),
  );
}

/** Every command the spy was asked to post, parsed. */
function sentCommands(sent: ReturnType<typeof vi.fn>): unknown[] {
  return sent.mock.calls.map((call) => JSON.parse(String(call[0])));
}

describe("the video pane's kept settings and its players", () => {
  it("#953 A3 a kept speed is sent to the pane's player once it reports ready", async () => {
    localStorage.setItem(KEPT, JSON.stringify({ rate: 1.5 }));
    open();

    const frame = (await screen.findByTitle("video")) as HTMLIFrameElement;
    const sent = vi.fn();
    vi.spyOn(frame.contentWindow as Window, "postMessage").mockImplementation(sent);

    hear(frame.contentWindow, { event: "onReady" });

    expect(sentCommands(sent)).toContainEqual({
      event: "command",
      func: "setPlaybackRate",
      args: [1.5],
    });
  });

  it("#953 A3 a speed the pane's player reports is kept in the browser", async () => {
    open();

    const frame = (await screen.findByTitle("video")) as HTMLIFrameElement;
    hear(frame.contentWindow, { event: "onPlaybackRateChange", info: 2 });

    expect(JSON.parse(localStorage.getItem(KEPT) ?? "{}")).toEqual({ rate: 2 });
  });

  it("#953 A4 captions the pane's player reports on are kept in the browser", async () => {
    open();

    const frame = (await screen.findByTitle("video")) as HTMLIFrameElement;
    hear(frame.contentWindow, {
      event: "apiInfoDelivery",
      info: { captions: { track: { languageCode: "en" } } },
    });

    expect(JSON.parse(localStorage.getItem(KEPT) ?? "{}")).toEqual({ captions: true });
  });

  it("#953 A4 captions the pane's player reports off are kept off in the browser", async () => {
    localStorage.setItem(KEPT, JSON.stringify({ captions: true }));
    open();

    const frame = (await screen.findByTitle("video")) as HTMLIFrameElement;
    hear(frame.contentWindow, { event: "apiInfoDelivery", info: { captions: { track: {} } } });

    expect(JSON.parse(localStorage.getItem(KEPT) ?? "{}")).toEqual({ captions: false });
  });

  it("#953 A4 the pane's player opens with captions on while they are kept on", async () => {
    localStorage.setItem(KEPT, JSON.stringify({ captions: true }));
    open();

    expect(await screen.findByTitle("video")).toHaveAttribute(
      "src",
      "https://www.youtube.com/embed/dQw4w9WgXcQ?enablejsapi=1&cc_load_policy=1",
    );
  });

  it("#953 I1 a delivery from another frame neither stops nor moves the pane's player", async () => {
    const { onWatched } = open();

    const frame = (await screen.findByTitle("video")) as HTMLIFrameElement;
    const other = document.createElement("iframe");
    document.body.append(other);
    hear(frame.contentWindow, { event: "infoDelivery", info: { playerState: 1, currentTime: 12 } });
    hear(other.contentWindow, {
      event: "infoDelivery",
      info: { playerState: 2, currentTime: 200 },
    });

    expect(onWatched).not.toHaveBeenCalled();

    // The same delivery from the pane's own frame is the pane's to act on.
    hear(frame.contentWindow, {
      event: "infoDelivery",
      info: { playerState: 2, currentTime: 200 },
    });
    expect(onWatched).toHaveBeenCalledWith(ID, 200);
    other.remove();
  });

  it("#953 I2 a video played to its end drops its position, and closing the pane writes nothing back", async () => {
    const { onWatched, unmount } = open();

    const frame = (await screen.findByTitle("video")) as HTMLIFrameElement;
    hear(frame.contentWindow, { event: "infoDelivery", info: { playerState: 1, currentTime: 12 } });
    hear(frame.contentWindow, {
      event: "infoDelivery",
      info: { playerState: 0, currentTime: 300 },
    });
    expect.soft(onWatched.mock.calls).toEqual([[ID, 0]]);

    unmount();
    expect.soft(onWatched.mock.calls).toEqual([[ID, 0]]);
  });
});
