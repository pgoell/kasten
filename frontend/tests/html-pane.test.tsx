import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { HtmlPane } from "@/components/html-pane";
import { encodePath } from "@/lib/note-path";
import { applyTheme } from "@/lib/theme";
import { hostLeader, type LeaderOpener } from "@/lib/which-key";
import { stubMatchMedia } from "./match-media";
import { stubCommands } from "./stub-commands";

const PATH = "30 Research/report.html";

/** The opener the panel was handed last, which is what a Space press hands over. */
function openerOf(spy: ReturnType<typeof vi.fn>): LeaderOpener {
  return spy.mock.lastCall?.[0] as LeaderOpener;
}

/** Runs what the typed keys name, and fails the test when they name nothing. */
function runFrom(opener: LeaderOpener, typed: string) {
  const action = opener.resolve(typed);
  if (action === null) throw new Error(`${typed} names nothing`);
  action();
}

/**
 * A message as the window hears it, from `source`, the way a page's script posts
 * one. Inside `act` because the pane may set its pending keys, which a native
 * event does not flush the way a React one would.
 */
function fromPage(source: Window | null, data: unknown) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, source }));
  });
}

function renderPane(commands = stubCommands(), path = PATH) {
  const view = render(<HtmlPane path={path} commands={commands} onFocus={() => {}} />);
  const frame = view.container.querySelector("iframe") as HTMLIFrameElement;
  const section = view.container.querySelector("[data-html-pane]") as HTMLElement;
  return { frame, section, commands };
}

/**
 * A parent whose layout effect clicks into the page when `click` turns true.
 *
 * A click into a frame is seen as the window's `blur` with the frame active,
 * so that is what this sends. A child's layout effects run before its
 * parent's, so it lands after the pane has committed the render with the new
 * `onFocus` and before any passive effect of it has run, which `rerender`
 * cannot reach: it flushes the passive effects before it returns.
 */
function ClickOnCommit({ onFocus, click }: { onFocus: () => void; click: boolean }) {
  useLayoutEffect(() => {
    if (!click) return;
    // The header's name carries the same title, so the frame is found by tag.
    document.querySelector("iframe")?.focus();
    window.dispatchEvent(new Event("blur"));
  }, [click]);
  return <HtmlPane path={PATH} commands={stubCommands()} onFocus={onFocus} />;
}

describe("the html pane", () => {
  it("calls the new onFocus for a click into the page before the passive effects of a render", () => {
    const old = vi.fn();
    const fresh = vi.fn();
    const { rerender } = render(<ClickOnCommit onFocus={old} click={false} />);

    rerender(<ClickOnCommit onFocus={fresh} click />);

    expect([old.mock.calls.length, fresh.mock.calls.length]).toEqual([0, 1]);
  });

  it("a theme or palette switch posts both to the page again, without a reload", () => {
    stubMatchMedia({});
    localStorage.clear();
    const { container } = render(
      <HtmlPane path={PATH} commands={stubCommands()} onFocus={() => {}} />,
    );
    const frame = container.querySelector("iframe") as HTMLIFrameElement;
    const sent = vi
      .spyOn(frame.contentWindow as Window, "postMessage")
      .mockImplementation(() => {});
    const src = frame.getAttribute("src");

    localStorage.setItem("kasten.palette", "russet");
    applyTheme();

    expect({ posts: sent.mock.calls, src: frame.getAttribute("src") }).toEqual({
      posts: [
        [{ kasten: "theme", theme: "light" }, "*"],
        [{ kasten: "palette", palette: "russet" }, "*"],
      ],
      src,
    });
  });

  it("the frame loads the page with the theme and the palette, and a switch keeps its address", () => {
    stubMatchMedia({});
    localStorage.clear();
    localStorage.setItem("kasten.palette", "russet");
    const { frame, section } = renderPane();
    const loaded = frame.getAttribute("src");
    const href = within(section)
      .getByRole("link", { name: "Open in a browser tab" })
      .getAttribute("href");

    localStorage.setItem("kasten.theme", "dark");
    applyTheme();

    expect({ src: frame.getAttribute("src"), href }).toEqual({
      src: loaded,
      href: `/api/html/${encodePath(PATH)}`,
    });
    expect(loaded).toBe(`/api/html/${encodePath(PATH)}?theme=light&palette=russet`);
  });

  it("hello is answered with the theme and the palette", () => {
    stubMatchMedia({});
    localStorage.clear();
    localStorage.setItem("kasten.palette", "russet");
    const { frame } = renderPane();
    const sent = vi
      .spyOn(frame.contentWindow as Window, "postMessage")
      .mockImplementation(() => {});

    fromPage(frame.contentWindow, { kasten: "hello" });

    expect(sent.mock.calls).toEqual([
      [{ kasten: "theme", theme: "light" }, "*"],
      [{ kasten: "palette", palette: "russet" }, "*"],
    ]);
  });

  it("the frame's load posts the theme and the palette too", () => {
    stubMatchMedia({});
    localStorage.clear();
    localStorage.setItem("kasten.palette", "russet");
    const { frame } = renderPane();
    const sent = vi
      .spyOn(frame.contentWindow as Window, "postMessage")
      .mockImplementation(() => {});

    fireEvent.load(frame);

    expect(sent.mock.calls).toEqual([
      [{ kasten: "theme", theme: "light" }, "*"],
      [{ kasten: "palette", palette: "russet" }, "*"],
    ]);
  });

  it("a Space from the page opens the which-key panel and Space f f runs findNote", () => {
    const spy = vi.fn();
    const off = hostLeader(spy);
    const { frame, commands } = renderPane();

    frame.focus();
    fromPage(frame.contentWindow, { kasten: "key", key: " " });

    expect(spy).toHaveBeenCalledTimes(1);
    runFrom(openerOf(spy), "ff");
    expect(commands.findNote).toHaveBeenCalledTimes(1);
    off();
  });

  it("with no panel mounted, a Space from the page leaves the next keys to the pane", () => {
    const { frame, section, commands } = renderPane();

    frame.focus();
    fromPage(frame.contentWindow, { kasten: "key", key: " " });
    expect(document.activeElement).toBe(section);
    fireEvent.keyDown(section, { key: "f" });
    fireEvent.keyDown(section, { key: "f" });

    expect(commands.findNote).toHaveBeenCalledTimes(1);
  });

  it("a question mark from the page opens key help", () => {
    const { frame, commands } = renderPane();

    frame.focus();
    fromPage(frame.contentWindow, { kasten: "key", key: "?" });

    expect(commands.showHelp).toHaveBeenCalledTimes(1);
  });

  it("Escape from the page gives the keys back to the pane", () => {
    const spy = vi.fn();
    const off = hostLeader(spy);
    const { frame, section } = renderPane();

    frame.focus();
    fromPage(frame.contentWindow, { kasten: "key", key: "Escape" });
    expect(document.activeElement).toBe(section);

    // The next Space comes to the section's own onKeyDown, which hands it on.
    fireEvent.keyDown(section, { key: " " });
    expect(spy).toHaveBeenCalledTimes(1);
    off();
  });

  it("after the panel closes, the focus goes back to the page frame", () => {
    const spy = vi.fn();
    const off = hostLeader(spy);
    const { frame, section } = renderPane();

    frame.focus();
    fromPage(frame.contentWindow, { kasten: "key", key: " " });
    expect(spy).toHaveBeenCalledTimes(1);
    const opener = openerOf(spy);
    expect(opener.from).toBe(frame);

    // The panel takes the focus, then gives it back to where Space was pressed.
    section.focus();
    (opener.from as HTMLElement).focus();
    expect(document.activeElement).toBe(frame);
    off();
  });

  it("a key from a page that does not hold the focus does nothing", () => {
    const spy = vi.fn();
    const off = hostLeader(spy);
    const { frame, section, commands } = renderPane();

    fromPage(frame.contentWindow, { kasten: "key", key: " " });
    fromPage(frame.contentWindow, { kasten: "key", key: "?" });
    fromPage(frame.contentWindow, { kasten: "key", key: "Escape" });

    expect(spy).not.toHaveBeenCalled();
    expect(commands.showHelp).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(section);

    // The same Space once the frame holds the focus is heard.
    frame.focus();
    fromPage(frame.contentWindow, { kasten: "key", key: " " });
    expect(spy).toHaveBeenCalledTimes(1);
    off();
  });

  it("a message from another window is ignored", () => {
    const spy = vi.fn();
    const off = hostLeader(spy);
    const { frame, commands } = renderPane();
    // A frame nested in the page would be another window, as would one the page opened.
    const nested = document.createElement("iframe");
    document.body.appendChild(nested);
    const posted = vi
      .spyOn(frame.contentWindow as Window, "postMessage")
      .mockImplementation(() => {});

    frame.focus();
    for (const source of [nested.contentWindow, window, null]) {
      fromPage(source, { kasten: "key", key: " " });
      fromPage(source, { kasten: "key", key: "?" });
      fromPage(source, { kasten: "hello" });
    }

    expect({
      leader: spy.mock.calls.length,
      help: vi.mocked(commands.showHelp).mock.calls.length,
      posts: posted.mock.calls.length,
    }).toEqual({ leader: 0, help: 0, posts: 0 });
    expect(document.activeElement).toBe(frame);

    // The same key from the frame itself is heard, so the ones above were
    // dropped for their source and not for never arriving.
    fromPage(frame.contentWindow, { kasten: "key", key: "?" });
    expect(commands.showHelp).toHaveBeenCalledTimes(1);
    nested.remove();
    off();
  });

  it("only Space, question mark and Escape act, and a malformed message throws nothing", () => {
    const spy = vi.fn();
    const off = hostLeader(spy);
    const { frame, commands } = renderPane();
    const errors = vi.fn();
    window.addEventListener("error", errors);

    frame.focus();
    for (const data of [
      { kasten: "key", key: "a" },
      { kasten: "key", key: "Enter" },
      { kasten: "key", key: 32 },
      { kasten: "key" },
      { key: " " },
      { kasten: "other", key: " " },
      null,
      "kasten",
    ]) {
      fromPage(frame.contentWindow, data);
    }

    expect({
      leader: spy.mock.calls.length,
      help: vi.mocked(commands.showHelp).mock.calls.length,
      errors: errors.mock.calls.length,
    }).toEqual({ leader: 0, help: 0, errors: 0 });

    // The key that does act, so the empty counts above mean the keys were refused.
    fromPage(frame.contentWindow, { kasten: "key", key: "?" });
    expect(commands.showHelp).toHaveBeenCalledTimes(1);
    window.removeEventListener("error", errors);
    off();
  });

  it("in a split each pane answers only its own frame", () => {
    const a = stubCommands();
    const b = stubCommands();
    const view = render(
      <>
        <HtmlPane path="a.html" commands={a} onFocus={() => {}} />
        <HtmlPane path="b.html" commands={b} onFocus={() => {}} />
      </>,
    );
    const frames = view.container.querySelectorAll("iframe");
    const frameA = frames[0] as HTMLIFrameElement;
    const frameB = frames[1] as HTMLIFrameElement;

    frameB.focus();
    fromPage(frameB.contentWindow, { kasten: "key", key: "?" });
    fromPage(frameA.contentWindow, { kasten: "key", key: "?" });
    frameA.focus();
    fromPage(frameB.contentWindow, { kasten: "key", key: "?" });

    expect({
      a: vi.mocked(a.showHelp).mock.calls.length,
      b: vi.mocked(b.showHelp).mock.calls.length,
    }).toEqual({ a: 0, b: 1 });
  });

  it("the header shows PAGE, the path in mono and an Open in a browser tab link", () => {
    const { frame, section } = renderPane();

    const link = within(section).getByRole("link", { name: "Open in a browser tab" });
    expect({
      label: screen.getByText("page").classList.contains("uppercase"),
      path: screen.getByText(PATH).classList.contains("font-mono"),
      sectionMono: section.classList.contains("font-mono"),
      href: link.getAttribute("href"),
      // The frame's address also carries the look, which the link leaves out (#786).
      sameAsFrame: link.getAttribute("href") === frame.getAttribute("src")?.split("?")[0],
      target: link.getAttribute("target"),
      rel: link.getAttribute("rel"),
    }).toEqual({
      label: true,
      path: true,
      sectionMono: false,
      href: `/api/html/${encodePath(PATH)}`,
      sameAsFrame: true,
      target: "_blank",
      rel: "noopener",
    });
  });

  it("the frame keeps no allow-same-origin", () => {
    const { frame } = renderPane();

    expect(frame.getAttribute("sandbox")).toBe(
      "allow-scripts allow-popups allow-popups-to-escape-sandbox",
    );
  });

  it("with vim off, a Space from the page still opens the which-key panel", () => {
    localStorage.setItem("kasten.vim", "off");
    const spy = vi.fn();
    const off = hostLeader(spy);
    try {
      const { frame } = renderPane();

      frame.focus();
      fromPage(frame.contentWindow, { kasten: "key", key: " " });

      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      off();
      localStorage.removeItem("kasten.vim");
    }
  });
});
