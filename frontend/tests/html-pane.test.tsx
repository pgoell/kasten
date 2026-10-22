import { fireEvent, render } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { HtmlPane } from "@/components/html-pane";
import { applyTheme } from "@/lib/theme";
import { stubMatchMedia } from "./match-media";
import { stubCommands } from "./stub-commands";

const PATH = "30 Research/report.html";

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

  it("posts the palette to the page on load and on a switch, without a reload", () => {
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

    fireEvent.load(frame);
    localStorage.setItem("kasten.palette", "russet");
    applyTheme();

    expect({ posts: sent.mock.calls, src: frame.getAttribute("src") }).toEqual({
      posts: [
        [{ kasten: "palette", palette: "poel" }, "*"],
        [{ kasten: "palette", palette: "russet" }, "*"],
      ],
      src,
    });
  });
});
