import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderSession } from "./review-session-fixture";

describe("ReviewSession centring the card (#600)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  // jsdom lays nothing out, so the classes are what is asserted here and the
  // frame test `review-center` measures where the text lands.
  it("#600 A3 Center centres the card across and down, and off keeps today's layout", async () => {
    const card = await renderSession();
    // The centring classes sit on the swipe wrapper around the card, which is the
    // flex child of the column, so the wrapper is what is checked.
    const box = card.parentElement as HTMLElement;
    const column = box.parentElement as HTMLElement;
    const toggle = screen.queryByRole("button", { name: "Center" });
    expect(toggle).not.toBeNull();
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(box).not.toHaveClass("text-center");
    expect(column).not.toHaveClass("flex");

    fireEvent.click(toggle as HTMLElement);

    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(box).toHaveClass("my-auto", "w-full", "text-center");
    expect(column).toHaveClass("flex", "flex-col", "overflow-auto");
    // A card taller than the pane would lose its top to `justify-center`.
    expect(column).not.toHaveClass("justify-center");

    fireEvent.click(toggle as HTMLElement);

    expect(box).not.toHaveClass("text-center");
    expect(column).not.toHaveClass("flex");
  });

  it("#600 A4 remembers Center across a remount", async () => {
    await renderSession();
    const toggle = screen.queryByRole("button", { name: "Center" });
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle as HTMLElement);
    expect(localStorage.getItem("kasten.review.center")).toBe("on");

    cleanup();
    const card = await renderSession();

    expect(screen.getByRole("button", { name: "Center" })).toHaveAttribute("aria-pressed", "true");
    expect(card.parentElement).toHaveClass("text-center");
  });
});
