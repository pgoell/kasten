import { render, screen, within } from "@testing-library/react";
import { KeyHelp } from "@/components/key-help";

/** The "In review" table, found by its heading, as the key help draws it. */
function review() {
  return within(screen.getByRole("heading", { name: "In review" }).parentElement as HTMLElement);
}

describe("KeyHelp under In review (#790 A7)", () => {
  it("#790 A7 lists every review key with its label, in In review", () => {
    render(<KeyHelp onClose={() => {}} />);

    expect(review().getByText("s").nextElementSibling).toHaveTextContent("Park the card");
    expect(review().getByText("n").nextElementSibling).toHaveTextContent("Write a new question");
    expect(review().getByText("Space or Enter").nextElementSibling).toHaveTextContent(
      "Show the answer, then grade Good",
    );
    expect(review().getByText("1 … 4").nextElementSibling).toHaveTextContent(
      "Rate the card: again, hard, good, easy",
    );
    expect(review().getByText("u").nextElementSibling).toHaveTextContent(
      "Undo the last answer, or put a parked card back",
    );
    expect(review().getByText("h").nextElementSibling).toHaveTextContent("Back to the decks");
  });
});
