import { render, screen } from "@testing-library/react";
import { TabStrip } from "@/components/pane-layout";
import { addTab, emptyLayout } from "@/lib/panes";
import { renderSession } from "./review-session-fixture";

describe("the tab strip and the review question carry their motion classes (#798)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("the tab strip is glass that stays at the top, with one hairline", () => {
    render(<TabStrip layout={addTab(emptyLayout("a.md"))} onSelect={() => {}} />);

    expect(screen.getByRole("tablist")).toHaveClass("k-glass", "k-hairline", "sticky");
  });

  it("the review question is set at 28 px on a phone", async () => {
    const card = await renderSession();

    // The scroller holds the answer and the loading and done lines too, so the
    // size is on the question's own wrapper and not on what contains it.
    expect(screen.queryByTestId("review-question")).not.toBeNull();
    expect(card.parentElement).not.toHaveClass("max-md:text-[28px]");
    const question = screen.getByTestId("review-question");
    expect(question).toHaveClass(
      "max-md:text-[28px]",
      "max-md:leading-[1.15]",
      "max-md:tracking-[var(--k-track-title)]",
    );
    expect(card).toContainElement(question);
  });
});
