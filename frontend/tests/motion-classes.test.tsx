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

    expect(card.parentElement).toHaveClass("max-md:text-[28px]");
  });
});
