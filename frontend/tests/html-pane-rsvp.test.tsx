import { act, fireEvent, render, screen } from "@testing-library/react";
import { HtmlPane } from "@/components/html-pane";
import type { RsvpAsk } from "@/lib/use-rsvp";
import { stubCommands } from "./stub-commands";

vi.mock("@/lib/rsvp-api", () => ({
  fetchRsvp: () => Promise.resolve(null),
  saveRsvp: () => Promise.resolve({}),
}));

const PATH = "30 Research/report.html";

function pane(rsvp: RsvpAsk) {
  return <HtmlPane path={PATH} commands={stubCommands()} onFocus={() => {}} rsvp={rsvp} />;
}

describe("RSVP over a page", () => {
  it("keeps a second read's waiter when the first read's time runs out", async () => {
    vi.useFakeTimers();
    try {
      const view = render(pane({ here: false, signal: 0 }));
      const frame = view.container.querySelector("iframe") as HTMLIFrameElement;

      // The first read asks the page and is closed before it answers.
      view.rerender(pane({ here: false, signal: 1 }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

      // The second asks again, and the first one's five seconds run out meanwhile.
      view.rerender(pane({ here: false, signal: 2 }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2500);
      });

      await act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { kasten: "text", text: "Hello world" },
            source: frame.contentWindow,
          }),
        );
        await vi.advanceTimersByTimeAsync(0);
      });
      const output = screen.getByRole("dialog").querySelector("output");
      expect([...(output?.children ?? [])].map((span) => span.textContent).join("")).toBe("Hello");
    } finally {
      vi.useRealTimers();
    }
  });
});
