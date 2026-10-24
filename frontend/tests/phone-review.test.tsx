import { render, screen, within } from "@testing-library/react";
import { ReviewAnswer } from "@/components/review-answer";

// The footer as a card's two sides draw it, with no interval known yet.
const props = {
  typing: false,
  typed: "",
  onTyped: () => {},
  undoing: false,
  jotOpen: false,
  next: null,
  onReveal: () => {},
  onRate: () => {},
  onPark: () => {},
  onCapture: () => {},
};

it("#793 A11 the grade buttons ask for 64 px under a coarse pointer", () => {
  const { container } = render(<ReviewAnswer {...props} shown />);

  const buttons = [...container.querySelectorAll<HTMLButtonElement>("button[data-rating]")];
  expect(buttons.map((button) => button.dataset.rating)).toEqual(["again", "hard", "good", "easy"]);
  // No number or key hint rides on a grade: each button's text is its label alone.
  expect(buttons.map((button) => button.textContent)).toEqual(["Again", "Hard", "Good", "Easy"]);
  for (const button of buttons) {
    // jsdom applies no media query, so the class is what a finger's screen is given.
    expect(button, button.dataset.rating).toHaveClass("pointer-coarse:min-h-16");
    expect(button, button.dataset.rating).not.toHaveClass("pointer-coarse:min-h-14");
  }
  // Four in one row: the four buttons share the grid that holds them.
  expect(buttons[0]?.parentElement?.parentElement).toHaveClass("grid-cols-4");
});

it("#793 A11 Show the answer hides its Space hint under a coarse pointer", () => {
  render(<ReviewAnswer {...props} shown={false} />);

  const reveal = screen.getByRole("button", { name: "Show the answer" });
  expect(within(reveal).getByText("Space")).toHaveClass("pointer-coarse:hidden");
});
