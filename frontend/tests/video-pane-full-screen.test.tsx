import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { VideoPane } from "@/components/video-pane";
import { hostLeader } from "@/lib/which-key";
import { stubCommands } from "./stub-commands";

// Standing in for the module rather than for `fetch`, as the shield's tests do.
const { fetchNote } = vi.hoisted(() => ({ fetchNote: vi.fn() }));
vi.mock("@/lib/api", () => ({ fetchNote }));

const NOTE = "lit/attention is all you need.md";
const TEXT = "# The talk\n\n[the recording](https://youtu.be/dQw4w9WgXcQ)\n";

// jsdom has no Fullscreen API, so these stand in for the browser's: a request
// makes the element full screen and says so, as the browser does, and an exit
// undoes it. Soft assertions throughout, so on a main without the feature every
// assertion of a test is still reached.
let enabled = true;
let fullElement: Element | null = null;
const request = vi.fn();
const exit = vi.fn();

/** The browser's own change of full screen, Esc's included. */
function becomes(element: Element | null) {
  fullElement = element;
  act(() => {
    document.dispatchEvent(new Event("fullscreenchange"));
  });
}

beforeEach(() => {
  enabled = true;
  fullElement = null;
  fetchNote.mockReset();
  fetchNote.mockResolvedValue(TEXT);
  request.mockReset();
  request.mockImplementation(function (this: Element) {
    becomes(this);
    return Promise.resolve();
  });
  exit.mockReset();
  exit.mockImplementation(() => {
    becomes(null);
    return Promise.resolve();
  });
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, get: () => enabled });
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullElement,
  });
  Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exit });
  Object.defineProperty(Element.prototype, "requestFullscreen", {
    configurable: true,
    value: request,
  });
});

afterEach(() => {
  localStorage.removeItem("kasten.vim");
  for (const name of ["fullscreenEnabled", "fullscreenElement", "exitFullscreen"]) {
    Reflect.deleteProperty(document, name);
  }
  Reflect.deleteProperty(Element.prototype, "requestFullscreen");
});

/** The pane over a note already read, so the frame and the shield are up in the first commit. */
function renderPane(text = TEXT) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["note", NOTE], text);
  const commands = stubCommands();
  const { container, unmount } = render(
    <QueryClientProvider client={client}>
      <VideoPane
        note={NOTE}
        commands={commands}
        focusSignal={1}
        playSignal={0}
        onWatched={vi.fn()}
        archive={false}
        onTake={async () => null}
      />
    </QueryClientProvider>,
  );
  const sent = vi.fn();
  const frame = container.querySelector("iframe");
  if (frame?.contentWindow) vi.spyOn(frame.contentWindow, "postMessage").mockImplementation(sent);
  const pane = container.querySelector("[data-video-pane]") as HTMLElement;
  const shield = container.querySelector("[data-video-shield]");
  return { commands, pane, frame, shield, sent, unmount };
}

/** A button by its name, or null; a click on a missing one is a soft failure, not a throw. */
function press(name: string) {
  const button = screen.queryByRole("button", { name });
  expect.soft(button, `a ${name} button`).not.toBeNull();
  if (button !== null) fireEvent.click(button);
}

/** The commands the frame was sent, by name. */
function funcsOf(sent: ReturnType<typeof vi.fn>) {
  return sent.mock.calls.map((call) => (JSON.parse(String(call[0])) as { func: string }).func);
}

describe("the video pane's own full screen", () => {
  it("#914 A1 Full screen in the header asks for full screen on the player box, which holds the frame and the shield", () => {
    const { frame, shield } = renderPane();

    press("Full screen");

    expect.soft(request).toHaveBeenCalledTimes(1);
    const box = request.mock.contexts[0] as Element | undefined;
    expect.soft(box?.contains(frame)).toBe(true);
    expect.soft(box?.contains(shield)).toBe(true);
    expect
      .soft(screen.queryByRole("button", { name: "Full screen" }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("#914 A2 f over the pane goes full screen, with vim on", () => {
    localStorage.setItem("kasten.vim", "on");
    const { pane, frame } = renderPane();

    const handled = fireEvent.keyDown(pane, { key: "f" });

    expect.soft(handled).toBe(false);
    expect.soft(request).toHaveBeenCalledTimes(1);
    expect.soft((request.mock.contexts[0] as Element | undefined)?.contains(frame)).toBe(true);
  });

  it("#914 A2 f over the pane goes full screen, with vim off", () => {
    localStorage.setItem("kasten.vim", "off");
    const { pane, frame } = renderPane();

    const handled = fireEvent.keyDown(pane, { key: "f" });

    expect.soft(handled).toBe(false);
    expect.soft(request).toHaveBeenCalledTimes(1);
    expect.soft((request.mock.contexts[0] as Element | undefined)?.contains(frame)).toBe(true);
  });

  it("#914 A3 full screen, a click on the shield still plays the video and keeps the focus in the box", () => {
    const { pane, shield, sent } = renderPane();

    fireEvent.keyDown(pane, { key: "f" });
    if (shield !== null) fireEvent.click(shield);

    expect.soft(funcsOf(sent)).toEqual(["playVideo"]);
    expect.soft(fullElement).not.toBeNull();
    expect.soft(document.activeElement).toBe(fullElement);
  });

  it("#914 A4 full screen, the focus is in the box and k pressed there plays the video", () => {
    const { pane, sent } = renderPane();

    fireEvent.keyDown(pane, { key: "f" });
    expect.soft(fullElement).not.toBeNull();
    expect.soft(document.activeElement).toBe(fullElement);
    fireEvent.keyDown(document.activeElement as Element, { key: "k" });

    expect.soft(funcsOf(sent)).toEqual(["playVideo"]);
  });

  it("#1395 A5 full screen, ArrowUp, ArrowDown and m pressed in the box set the volume and mute", () => {
    localStorage.setItem("kasten.video.1", JSON.stringify({ volume: 50 }));
    const { pane, sent } = renderPane();

    fireEvent.keyDown(pane, { key: "f" });
    expect.soft(document.activeElement).toBe(fullElement);
    for (const key of ["ArrowUp", "ArrowDown", "ArrowDown", "m"]) {
      fireEvent.keyDown(document.activeElement as Element, { key });
    }

    expect.soft(funcsOf(sent)).toEqual(["setVolume", "setVolume", "setVolume", "mute"]);
    expect.soft(fullElement).not.toBeNull();
    localStorage.removeItem("kasten.video.1");
  });

  it("#914 A5 Esc leaving full screen takes the exit button away and gives the focus back to the pane", () => {
    const { pane } = renderPane();

    fireEvent.keyDown(pane, { key: "f" });
    expect.soft(screen.queryByRole("button", { name: "Exit full screen" })).not.toBeNull();
    // Esc is the browser's: no key event reaches the page, only the change.
    becomes(null);

    expect.soft(screen.queryByRole("button", { name: "Exit full screen" })).toBeNull();
    expect.soft(document.activeElement).toBe(pane);
    expect
      .soft(screen.queryByRole("button", { name: "Full screen" }))
      .toHaveAttribute("aria-pressed", "false");
  });

  it("#914 A5 f again and Exit full screen on the player each leave full screen", () => {
    const { pane } = renderPane();

    fireEvent.keyDown(pane, { key: "f" });
    fireEvent.keyDown(document.activeElement as Element, { key: "f" });
    expect.soft(exit).toHaveBeenCalledTimes(1);
    expect.soft(document.activeElement).toBe(pane);

    fireEvent.keyDown(pane, { key: "f" });
    press("Exit full screen");

    expect.soft(request).toHaveBeenCalledTimes(2);
    expect.soft(exit).toHaveBeenCalledTimes(2);
    expect.soft(fullElement).toBeNull();
    expect.soft(document.activeElement).toBe(pane);
  });

  it("#914 A7 a tap on Full screen goes full screen, and where the browser has none the button is not drawn and f does nothing", () => {
    const first = renderPane();
    const button = screen.queryByRole("button", { name: "Full screen" });
    expect.soft(button).not.toBeNull();
    if (button !== null) {
      fireEvent.pointerDown(button, { pointerType: "touch" });
      fireEvent.pointerUp(button, { pointerType: "touch" });
      fireEvent.click(button);
    }
    expect.soft(request).toHaveBeenCalledTimes(1);
    becomes(null);
    first.unmount();

    // Safari on an iPhone: no full screen for a box.
    enabled = false;
    const { pane } = renderPane();
    fireEvent.keyDown(pane, { key: "f" });

    expect.soft(screen.queryByRole("button", { name: "Full screen" })).toBeNull();
    expect.soft(request).toHaveBeenCalledTimes(1);
  });

  it("#914 I1 full screen, Space keeps the leader in the pane without opening the which-key panel, and Space q still closes", () => {
    const host = vi.fn();
    const off = hostLeader(host);
    const { pane, commands } = renderPane();

    fireEvent.keyDown(pane, { key: "f" });
    const box = document.activeElement as Element;
    fireEvent.keyDown(box, { key: " " });
    fireEvent.keyDown(box, { key: "q" });

    expect.soft(request).toHaveBeenCalledTimes(1);
    expect.soft(host).not.toHaveBeenCalled();
    expect.soft(commands.closeNote).toHaveBeenCalledTimes(1);
    off();
  });

  it("#914 I2 a refused request leaves the pane as it was, with no exit button and no error", async () => {
    request.mockImplementation(() => Promise.reject(new TypeError("Permissions check failed")));
    const { pane } = renderPane();

    press("Full screen");
    await act(async () => {});

    expect.soft(request).toHaveBeenCalledTimes(1);
    expect.soft(screen.queryByRole("button", { name: "Exit full screen" })).toBeNull();
    expect.soft(document.activeElement).toBe(pane);
  });

  it("#914 I3 a note with no video has no Full screen button and f does nothing, while a note with one has it", () => {
    const empty = renderPane("# No video here\n");
    fireEvent.keyDown(empty.pane, { key: "f" });
    expect.soft(screen.queryByRole("button", { name: "Full screen" })).toBeNull();
    expect.soft(request).not.toHaveBeenCalled();
    empty.unmount();

    renderPane();
    expect.soft(screen.queryByRole("button", { name: "Full screen" })).not.toBeNull();
  });

  it("#914 I4 f with a leader pending is the leader's, and a bare f after it goes full screen", () => {
    const { pane, commands } = renderPane();

    fireEvent.keyDown(pane, { key: " " });
    fireEvent.keyDown(pane, { key: "f" });
    fireEvent.keyDown(pane, { key: "f" });
    expect.soft(commands.findNote).toHaveBeenCalledTimes(1);
    expect.soft(request).not.toHaveBeenCalled();

    fireEvent.keyDown(pane, { key: "f" });
    expect.soft(request).toHaveBeenCalledTimes(1);
  });

  it("#914 R1 Space then Esc in full screen drops the unseen leader, so k after it plays the video", () => {
    const { pane, sent, commands } = renderPane();

    fireEvent.keyDown(pane, { key: "f" });
    fireEvent.keyDown(document.activeElement as Element, { key: " " });
    // Esc is the browser's and reaches the page only as the change.
    becomes(null);
    fireEvent.keyDown(document.activeElement as Element, { key: "k" });

    expect.soft(request).toHaveBeenCalledTimes(1);
    expect.soft(funcsOf(sent)).toEqual(["playVideo"]);
    expect.soft(commands.paneUp).not.toHaveBeenCalled();
  });

  it("#914 R2 a leader sequence typed full screen leaves full screen before it runs, and the focus stays where it went", () => {
    const { pane, commands } = renderPane();
    const elsewhere = document.createElement("button");
    document.body.append(elsewhere);
    // A move to another pane, as `Space h` is: the focus goes outside the box.
    commands.closeNote.mockImplementation(() => elsewhere.focus());

    fireEvent.keyDown(pane, { key: "f" });
    fireEvent.keyDown(document.activeElement as Element, { key: " " });
    fireEvent.keyDown(document.activeElement as Element, { key: "q" });

    expect.soft(request).toHaveBeenCalledTimes(1);
    expect.soft(exit).toHaveBeenCalledTimes(1);
    expect.soft(commands.closeNote).toHaveBeenCalledTimes(1);
    expect
      .soft(exit.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY)
      .toBeLessThan(commands.closeNote.mock.invocationCallOrder[0] ?? 0);
    expect.soft(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it("#914 I5 Ctrl f and Cmd f are left to the browser, and a bare f goes full screen", () => {
    const { pane } = renderPane();

    expect.soft(fireEvent.keyDown(pane, { key: "f", ctrlKey: true })).toBe(true);
    expect.soft(fireEvent.keyDown(pane, { key: "f", metaKey: true })).toBe(true);
    expect.soft(request).not.toHaveBeenCalled();

    fireEvent.keyDown(pane, { key: "f" });
    expect.soft(request).toHaveBeenCalledTimes(1);
  });
});
