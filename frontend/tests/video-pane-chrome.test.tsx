import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
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

/** What the player says about the video itself: its title and who made it. */
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
  return { frame, sent };
}

describe("the video pane chrome", () => {
  it("#791 A1 the header reads VIDEO, the URL, Video view, Mute (#1395) and Open on YouTube in that order", async () => {
    const { pane } = renderPane();

    await screen.findByTitle("video");
    const header = pane.querySelector("header") as HTMLElement;
    expect(header.textContent).toBe(
      "VIDEOyoutube.com/watch?v=dQw4w9WgXcQVideo viewMuteOpen on YouTube",
    );
    expect(screen.getByTitle("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeInTheDocument();
    expect(pane).toHaveClass("font-sans");
    expect(pane).not.toHaveClass("font-mono");
  });

  it("#791 A1 Open on YouTube links the watch URL at the second the player is at, in a new tab", async () => {
    renderPane();

    await screen.findByTitle("video");
    act(() => reports(1, 75));
    const link = screen.getByRole("link", { name: "Open on YouTube" });
    expect(link).toHaveAttribute("href", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=75s");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("#791 A2 the title and the author come from the player's own delivery", async () => {
    renderPane();

    await screen.findByTitle("video");
    act(() =>
      delivers({ currentTime: 5, videoData: { title: "Talk title", author: "Grace Hopper" } }),
    );
    expect(screen.getByRole("heading", { name: "Talk title" })).toBeInTheDocument();
    expect(screen.getByText("Grace Hopper")).toBeInTheDocument();
  });

  it("#791 A2 the note's speaker wins over the player's author, with its link brackets taken off", async () => {
    fetchNote.mockResolvedValue(
      `---\nspeaker: "[[Ada Lovelace]]"\n---\n\n[the talk](https://youtu.be/dQw4w9WgXcQ)\n`,
    );
    renderPane();

    await screen.findByTitle("video");
    act(() => delivers({ currentTime: 5, videoData: { title: "Talk", author: "Grace Hopper" } }));
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.queryByText("Grace Hopper")).toBeNull();
  });

  it("#791 A2 with no delivery yet the title is the note's name", async () => {
    renderPane();

    await screen.findByTitle("video");
    expect(screen.getByRole("heading", { name: "attention is all you need" })).toBeInTheDocument();
  });

  it("#791 A2 the chapters are listed with their times, and the one at the second is marked", async () => {
    fetchNote.mockResolvedValue(
      `${TEXT}\n## Chapters\n\n[00:00] Intro\n[01:30] Method\n[03:00] End\n`,
    );
    renderPane();

    await screen.findByTitle("video");
    act(() => reports(1, 100));
    const list = screen.getByRole("list", { name: "Chapters" });
    expect(list).toHaveTextContent("01:30");
    expect(within(list).getByRole("button", { name: /Method/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(within(list).getByRole("button", { name: /Intro/ })).not.toHaveAttribute("aria-current");
  });

  it("#791 A2 a click on a chapter seeks the player to it and keeps the focus on the pane", async () => {
    fetchNote.mockResolvedValue(`${TEXT}\n## Chapters\n\n[00:00] Intro\n[01:30] Method\n`);
    const { pane } = renderPane();

    const { sent } = await spyOnFrame();
    const list = await screen.findByRole("list", { name: "Chapters" });
    fireEvent.click(within(list).getByRole("button", { name: /Method/ }));

    expect(sent.mock.calls.map((call) => JSON.parse(String(call[0])).func)).toEqual(["seekTo"]);
    expect(JSON.parse(String(sent.mock.calls[0]?.[0])).args).toEqual([90, true]);
    expect(pane).toHaveFocus();
  });

  it("#791 A3 the line under the chapters says where the place is kept", async () => {
    const { pane } = renderPane();

    await screen.findByTitle("video");
    expect(pane).toHaveTextContent(
      "Your place is kept in the note's watching field when you pause.",
    );
  });

  it("#791 A15 the player box is capped to the pane's height, not only its width", async () => {
    renderPane();

    const frame = await screen.findByTitle("video");
    const box = frame.parentElement as HTMLElement;
    // The cap is a share of the body's height, which only reads as one when the
    // body is a size container: the class names the capped width and the size.
    expect(box).toHaveClass("w-[min(100%,calc(70cqh*16/9))]", "mx-auto", "shrink-0");
    expect(box.parentElement?.parentElement).toHaveClass("[container-type:size]");
  });
});
