import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReviewSession } from "@/components/review-session";
import * as api from "@/lib/api";
import { shownCard } from "./review-card";
import { DECK, renderSession } from "./review-session-fixture";

describe("ReviewSession typing", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("asks for a button press when typing is off", async () => {
    await renderSession();

    expect(screen.getByRole("button", { name: "Show the answer" })).toBeInTheDocument();
    expect(screen.queryByLabelText("your answer")).not.toBeInTheDocument();
  });

  it("asks for the answer in writing once typing is on", async () => {
    await renderSession();

    fireEvent.click(screen.getByRole("button", { name: "Type" }));

    expect(screen.getByLabelText("your answer")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show the answer" })).not.toBeInTheDocument();
  });

  it("keeps the ratings back until the answer is in", async () => {
    await renderSession();
    fireEvent.click(screen.getByRole("button", { name: "Type" }));

    expect(screen.queryByRole("button", { name: "Good" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("your answer"), {
      target: { value: "Simple Storage Service" },
    });
    fireEvent.submit(screen.getByTestId("review-typed"));

    expect(screen.getByTestId("review-back")).toHaveTextContent("Simple Storage Service");
    expect(screen.getByRole("button", { name: "Good" })).toBeInTheDocument();
  });

  it("says the answer matched", async () => {
    await renderSession();
    fireEvent.click(screen.getByRole("button", { name: "Type" }));
    fireEvent.change(screen.getByLabelText("your answer"), {
      target: { value: "simple storage service" },
    });
    fireEvent.submit(screen.getByTestId("review-typed"));

    expect(screen.getByTestId("review-verdict")).toHaveTextContent("Matched");
  });

  it("A3 counts a typed a\\-b right against an imported back a\\\\-b", async () => {
    const note = "#flashcards/aws\n\nWhat is it?::a\\\\-b \\*c\\* <!--anki:1:0:abcdef12-->\n";
    vi.spyOn(api, "fetchReviewLimits").mockResolvedValue({
      new_per_day: null,
      reviews_per_day: null,
    });
    vi.spyOn(api, "fetchNote").mockResolvedValue(note);
    vi.spyOn(api, "saveNote").mockResolvedValue({ path: "decks/aws.md", content: note });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReviewSession deck={DECK} onLeave={vi.fn()} />
      </QueryClientProvider>,
    );
    await shownCard();

    fireEvent.click(screen.getByRole("button", { name: "Type" }));
    fireEvent.change(screen.getByLabelText("your answer"), { target: { value: "a\\-b *c*" } });
    fireEvent.submit(screen.getByTestId("review-typed"));

    expect(screen.getByTestId("review-verdict")).toHaveTextContent("Matched");
  });

  it("A3 counts a typed &#58; right against an imported back \\&#58;", async () => {
    const note = "#flashcards/aws\n\nWhat is it?::a\\\\\\&#58; \\&#58; <!--anki:1:0:abcdef12-->\n";
    vi.spyOn(api, "fetchReviewLimits").mockResolvedValue({
      new_per_day: null,
      reviews_per_day: null,
    });
    vi.spyOn(api, "fetchNote").mockResolvedValue(note);
    vi.spyOn(api, "saveNote").mockResolvedValue({ path: "decks/aws.md", content: note });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReviewSession deck={DECK} onLeave={vi.fn()} />
      </QueryClientProvider>,
    );
    await shownCard();

    fireEvent.click(screen.getByRole("button", { name: "Type" }));
    fireEvent.change(screen.getByLabelText("your answer"), {
      target: { value: "a\\&#58; &#58;" },
    });
    fireEvent.submit(screen.getByTestId("review-typed"));

    expect(screen.getByTestId("review-verdict")).toHaveTextContent("Matched");
  });

  it("shows what was typed beside the answer when it did not match", async () => {
    await renderSession();
    fireEvent.click(screen.getByRole("button", { name: "Type" }));
    fireEvent.change(screen.getByLabelText("your answer"), {
      target: { value: "Simple Store Service" },
    });
    fireEvent.submit(screen.getByTestId("review-typed"));

    const verdict = screen.getByTestId("review-verdict");
    expect(verdict).toHaveTextContent("Simple Store Service");
    // The rating is still yours to give: a mismatch never refuses one.
    expect(screen.getByRole("button", { name: "Easy" })).toBeInTheDocument();
  });

  it("remembers the toggle across a remount", async () => {
    await renderSession();
    fireEvent.click(screen.getByRole("button", { name: "Type" }));
    expect(localStorage.getItem("kasten.review.typing")).toBe("on");

    cleanup();
    await renderSession();

    expect(screen.getByLabelText("your answer")).toBeInTheDocument();
  });
});
