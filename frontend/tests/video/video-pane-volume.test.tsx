import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { VideoPane } from "@/components/video-pane";
import { stubCommands } from "../stub-commands";

// Standing in for the module rather than for `fetch`, as video-pane-settings.test.tsx does.
const { fetchNote } = vi.hoisted(() => ({ fetchNote: vi.fn() }));
vi.mock("@/lib/api", () => ({ fetchNote }));

const NOTE = "lit/attention is all you need.md";
const TEXT = "# The talk\n\n[the recording](https://youtu.be/dQw4w9WgXcQ)\n";
const TWO = `${TEXT}\n[part two](https://youtu.be/abcdefghijk)\n`;
const KEPT = "kasten.video.1";

beforeEach(() => {
  fetchNote.mockReset();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** One pane over `text`, its frame's posts caught in `sent`. */
async function open(text = TEXT) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["note", NOTE], text);
  const { container } = render(
    <QueryClientProvider client={client}>
      <VideoPane
        note={NOTE}
        commands={stubCommands()}
        focusSignal={1}
        playSignal={0}
        onWatched={vi.fn()}
        archive={false}
        onTake={async () => null}
      />
    </QueryClientProvider>,
  );
  const pane = container.querySelector("[data-video-pane]") as HTMLElement;
  const frame = container.querySelector("iframe") as HTMLIFrameElement;
  const sent = vi.fn();
  vi.spyOn(frame.contentWindow as Window, "postMessage").mockImplementation(sent);
  return { pane, frame, sent, container };
}

function hear(from: Window | null, body: unknown) {
  window.dispatchEvent(
    new MessageEvent("message", {
      origin: "https://www.youtube.com",
      source: from,
      data: JSON.stringify(body),
    }),
  );
}

/** The commands the frame was sent, as [func, args]. */
function sentOf(sent: ReturnType<typeof vi.fn>): [string, unknown[]][] {
  return sent.mock.calls.map((call) => {
    const { func, args } = JSON.parse(String(call[0])) as { func: string; args: unknown[] };
    return [func, args];
  });
}

const kept = () => JSON.parse(localStorage.getItem(KEPT) ?? "{}");

describe("the video pane's volume (#1395)", () => {
  it("#1395 A1 ArrowUp and ArrowDown call setVolume 5 up and down from the player's level, and keep it", async () => {
    const { pane, frame, sent } = await open();
    hear(frame.contentWindow, { event: "infoDelivery", info: { volume: 50, muted: false } });

    expect.soft(fireEvent.keyDown(pane, { key: "ArrowUp" })).toBe(false);
    expect.soft(kept()).toEqual({ volume: 55, muted: false });
    fireEvent.keyDown(pane, { key: "ArrowDown" });
    fireEvent.keyDown(pane, { key: "ArrowDown" });

    expect.soft(sentOf(sent)).toEqual([
      ["setVolume", [55]],
      ["setVolume", [50]],
      ["setVolume", [45]],
    ]);
    expect.soft(kept()).toEqual({ volume: 45, muted: false });
  });

  it("#1395 A1 the level stops at 100 going up and at 0 going down", async () => {
    localStorage.setItem(KEPT, JSON.stringify({ volume: 98 }));
    const { pane, sent } = await open();

    fireEvent.keyDown(pane, { key: "ArrowUp" });
    fireEvent.keyDown(pane, { key: "ArrowUp" });
    localStorage.setItem(KEPT, JSON.stringify({ volume: 3 }));
    fireEvent.keyDown(pane, { key: "ArrowDown" });
    fireEvent.keyDown(pane, { key: "ArrowDown" });

    expect(sentOf(sent).map(([, args]) => args[0])).toEqual([100, 100, 0, 0]);
  });

  it("#1395 A2 m calls mute, and m again calls unMute and brings back the level from before", async () => {
    localStorage.setItem(KEPT, JSON.stringify({ volume: 40 }));
    const { pane, sent } = await open();

    fireEvent.keyDown(pane, { key: "m" });
    expect.soft(sentOf(sent)).toEqual([["mute", []]]);
    expect.soft(kept()).toEqual({ volume: 40, muted: true });
    expect.soft(screen.queryByRole("button", { name: "Unmute" })).not.toBeNull();

    fireEvent.keyDown(pane, { key: "m" });
    expect.soft(sentOf(sent)).toEqual([
      ["mute", []],
      ["unMute", []],
      ["setVolume", [40]],
    ]);
    expect.soft(kept()).toEqual({ volume: 40, muted: false });
  });

  it("#1395 I2 a volume key while muted unmutes at the new level", async () => {
    localStorage.setItem(KEPT, JSON.stringify({ volume: 40, muted: true }));
    const { pane, sent } = await open();

    fireEvent.keyDown(pane, { key: "ArrowUp" });

    expect.soft(sentOf(sent)).toEqual([
      ["setVolume", [45]],
      ["unMute", []],
    ]);
    expect.soft(kept()).toEqual({ volume: 45, muted: false });
    expect.soft(screen.queryByRole("button", { name: "Mute" })).not.toBeNull();
  });

  it("#1395 A3 the kept level and mute come back from kasten.video.1 when the pane's video loads", async () => {
    localStorage.setItem(KEPT, JSON.stringify({ volume: 30, muted: true }));
    const { frame, sent } = await open();

    hear(frame.contentWindow, { event: "onReady" });

    expect.soft(sentOf(sent)).toEqual([
      ["setVolume", [30]],
      ["mute", []],
    ]);
    expect.soft(screen.queryByRole("button", { name: "Unmute" })).not.toBeNull();
  });

  it("#1395 A4 a value kept before the volume still gives the pane its speed and captions", async () => {
    localStorage.setItem(KEPT, JSON.stringify({ rate: 1.5, captions: true }));
    const { pane, frame, sent } = await open();
    expect.soft(frame.getAttribute("src")).toContain("cc_load_policy=1");

    hear(frame.contentWindow, { event: "onReady" });
    expect.soft(sentOf(sent)).toEqual([["setPlaybackRate", [1.5]]]);
    fireEvent.keyDown(pane, { key: "ArrowDown" });

    expect.soft(kept()).toEqual({ rate: 1.5, captions: true, volume: 95, muted: false });
  });

  it("#1395 A7 a tap on Mute mutes, reads Unmute, unmutes on the next tap and gives the focus back to the pane", async () => {
    const { pane, sent } = await open();

    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    expect.soft(document.activeElement).toBe(pane);
    fireEvent.click(screen.getByRole("button", { name: "Unmute" }));

    expect.soft(sentOf(sent).map(([func]) => func)).toEqual(["mute", "unMute", "setVolume"]);
    expect.soft(screen.queryByRole("button", { name: "Mute" })).not.toBeNull();
  });

  it("#1395 I1 k, j and l send what they did, and the new keys with a modifier are left to the browser", async () => {
    const { pane, sent } = await open();

    fireEvent.keyDown(pane, { key: "k" });
    fireEvent.keyDown(pane, { key: "l" });
    expect.soft(fireEvent.keyDown(pane, { key: "ArrowUp", ctrlKey: true })).toBe(true);
    expect.soft(fireEvent.keyDown(pane, { key: "m", metaKey: true })).toBe(true);
    expect.soft(fireEvent.keyDown(pane, { key: "ArrowDown", altKey: true })).toBe(true);

    expect.soft(sentOf(sent)).toEqual([
      ["playVideo", []],
      ["seekTo", [10, true]],
    ]);
    expect.soft(localStorage.getItem(KEPT)).toBeNull();
  });

  it("#1395 I1 with no video in the note the new keys are left to the browser and there is no Mute", async () => {
    const client = new QueryClient();
    client.setQueryData(["note", NOTE], "# No video here\n");
    const { container } = render(
      <QueryClientProvider client={client}>
        <VideoPane
          note={NOTE}
          commands={stubCommands()}
          focusSignal={1}
          onWatched={vi.fn()}
          archive={false}
          onTake={async () => null}
        />
      </QueryClientProvider>,
    );
    const pane = container.querySelector("[data-video-pane]") as HTMLElement;

    expect.soft(fireEvent.keyDown(pane, { key: "ArrowUp" })).toBe(true);
    expect.soft(fireEvent.keyDown(pane, { key: "m" })).toBe(true);
    expect.soft(screen.queryByRole("button", { name: "Mute" })).toBeNull();
    expect.soft(localStorage.getItem(KEPT)).toBeNull();
  });

  it("#1395 I4 two panes: a key moves only its own pane's player, from the level the other pane kept", async () => {
    const first = await open();
    const second = await open();

    fireEvent.keyDown(first.pane, { key: "ArrowDown" });
    fireEvent.keyDown(second.pane, { key: "ArrowDown" });

    expect.soft(sentOf(first.sent)).toEqual([["setVolume", [95]]]);
    expect.soft(sentOf(second.sent)).toEqual([["setVolume", [90]]]);
  });

  it("#1395 I5 n to the next video, and a suggested video the player moved on to, keep the level", async () => {
    localStorage.setItem(KEPT, JSON.stringify({ volume: 30 }));
    const { pane, container } = await open(TWO);

    fireEvent.keyDown(pane, { key: "n" });
    const next = container.querySelector("iframe") as HTMLIFrameElement;
    const sent = vi.fn();
    vi.spyOn(next.contentWindow as Window, "postMessage").mockImplementation(sent);
    hear(next.contentWindow, { event: "onReady" });
    hear(next.contentWindow, {
      event: "infoDelivery",
      info: { videoData: { video_id: "zzzzzzzzzzz" }, volume: 30 },
    });
    fireEvent.keyDown(pane, { key: "ArrowUp" });

    expect(sentOf(sent)).toEqual([
      ["setVolume", [30]],
      ["setVolume", [35]],
    ]);
  });

  it("#1395 I6 with storage that throws the keys still move this player", async () => {
    const { pane, sent } = await open();
    const denied = () => {
      throw new DOMException("denied", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(denied);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(denied);

    fireEvent.keyDown(pane, { key: "ArrowDown" });
    fireEvent.keyDown(pane, { key: "ArrowDown" });
    fireEvent.keyDown(pane, { key: "m" });

    expect(sentOf(sent)).toEqual([
      ["setVolume", [95]],
      ["setVolume", [90]],
      ["mute", []],
    ]);
  });
});
