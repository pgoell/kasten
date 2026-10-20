import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReviewSession } from "@/components/review-session";
import * as api from "@/lib/api";
import { shownCard } from "./review-card";
import { DECK } from "./review-session-fixture";

describe("ReviewSession jotting a new question", () => {
  const DECK_NOTE = "#flashcards/aws\n\nWhat is a VPC?::A private cloud\n\nWhat is S3?::Storage\n";

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  function renderJot() {
    vi.spyOn(api, "fetchNote").mockResolvedValue(DECK_NOTE);
    const saved = vi.spyOn(api, "saveNote").mockResolvedValue({
      path: "decks/aws.md",
      content: DECK_NOTE,
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReviewSession deck={{ ...DECK, fresh: 2 }} onLeave={vi.fn()} />
      </QueryClientProvider>,
    );
    return saved;
  }

  it("appends it to the note the card on screen came from", async () => {
    const saved = renderJot();
    await shownCard();

    fireEvent.click(screen.getByRole("button", { name: "Jot" }));
    fireEvent.change(screen.getByLabelText("a new question"), {
      target: { value: "What is a moved block?" },
    });
    fireEvent.submit(screen.getByTestId("review-capture"));

    expect(saved.mock.calls[0]?.[0]).toBe("decks/aws.md");
    expect(saved.mock.calls[0]?.[1]).toContain("What is a moved block?::");
  });

  it("leaves the card on screen and the queue behind it alone", async () => {
    renderJot();
    await shownCard();
    expect(screen.getByText(/left/).textContent).toBe("2 left");

    fireEvent.click(screen.getByRole("button", { name: "Jot" }));
    fireEvent.change(screen.getByLabelText("a new question"), {
      target: { value: "What is a moved block?" },
    });
    fireEvent.submit(screen.getByTestId("review-capture"));

    expect(screen.getByTestId("review-card")).toHaveTextContent("What is a VPC?");
    expect(screen.getByText(/left/).textContent).toBe("2 left");
  });

  it("closes the field once the question is written", async () => {
    renderJot();
    await shownCard();

    fireEvent.click(screen.getByRole("button", { name: "Jot" }));
    fireEvent.change(screen.getByLabelText("a new question"), { target: { value: "Q" } });
    fireEvent.submit(screen.getByTestId("review-capture"));

    expect(screen.queryByLabelText("a new question")).not.toBeInTheDocument();
  });

  it("shuts the field on a second tap, writing nothing", async () => {
    const saved = renderJot();
    await shownCard();

    const button = screen.getByRole("button", { name: "Jot" });
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    fireEvent.change(screen.getByLabelText("a new question"), { target: { value: "Q" } });
    fireEvent.click(button);

    expect(screen.queryByLabelText("a new question")).not.toBeInTheDocument();
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(saved).not.toHaveBeenCalled();
  });

  // jsdom lays nothing out, so the class is the nearest thing to a width there
  // is to assert. "Jot" and "Type" are the two labels narrower than 44px.
  it("gives its narrow header buttons a thumb's width on a touch screen", async () => {
    renderJot();
    await shownCard();

    for (const name of ["Jot", "Type"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toHaveClass("min-h-11", "pointer-coarse:min-w-11");
    }
  });
});
