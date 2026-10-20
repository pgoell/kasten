import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReviewSession } from "@/components/review-session";
import * as api from "@/lib/api";
import { shownCard } from "./review-card";
import { DECK } from "./review-session-fixture";

describe("ReviewSession on a cloze", () => {
  const CLOZE = "#flashcards/aws\n\nThe capital of {{c1::France}} is {{c2::Paris::a city}}.\n";

  function renderCloze(text = CLOZE) {
    vi.spyOn(api, "fetchNote").mockResolvedValue(text);
    // The vault answers with what was sent: the next rating starts from it.
    const saved = vi
      .spyOn(api, "saveNote")
      .mockImplementation(async (path: string, content: string) => ({ path, content }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReviewSession deck={{ ...DECK, fresh: 2 }} onLeave={vi.fn()} />
      </QueryClientProvider>,
    );
    return saved;
  }

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("asks each number in turn, writing each one's own comment on the line", async () => {
    const saved = renderCloze();

    expect(await shownCard()).toHaveTextContent("The capital of [...] is Paris.");
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    expect(screen.getByTestId("review-back")).toHaveTextContent("France");
    fireEvent.click(screen.getByRole("button", { name: "Good" }));

    expect(saved.mock.calls[0]?.[1]).toMatch(
      /^#flashcards\/aws\n\nThe capital of \{\{c1::France\}\} is \{\{c2::Paris::a city\}\}\. <!--SR:c1![\d-]+,1,250-->\n$/,
    );

    await waitFor(() =>
      expect(screen.getByTestId("review-card")).toHaveTextContent(
        "The capital of France is [a city].",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Easy" }));

    expect(saved.mock.calls[1]?.[1]).toMatch(
      /^#flashcards\/aws\n\nThe capital of \{\{c1::France\}\} is \{\{c2::Paris::a city\}\}\. <!--SR:c1![\d-]+,1,250--> <!--SR:c2![\d-]+,4,250-->\n$/,
    );
    expect(await screen.findByTestId("review-done")).toBeInTheDocument();
  });

  it("rewrites one number's comment in place when it is asked again", async () => {
    const saved = renderCloze();
    await shownCard();

    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Again" }));
    // c2, then c1 once more at the back of the queue.
    await waitFor(() => expect(screen.getByTestId("review-card")).toHaveTextContent("[a city]"));
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Good" }));
    await waitFor(() => expect(screen.getByTestId("review-card")).toHaveTextContent("[...]"));
    fireEvent.click(screen.getByRole("button", { name: "Show answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Again" }));

    const last = saved.mock.calls.at(-1)?.[1] ?? "";
    expect(last.match(/<!--SR:c1!/g)).toHaveLength(1);
    expect(last.match(/<!--SR:c2!/g)).toHaveLength(1);
  });

  it("matches what was typed against the hidden text, not the sentence", async () => {
    renderCloze();
    await shownCard();
    fireEvent.click(screen.getByRole("button", { name: "Type" }));
    fireEvent.change(screen.getByLabelText("your answer"), { target: { value: "france" } });
    fireEvent.submit(screen.getByTestId("review-typed"));

    expect(screen.getByTestId("review-verdict")).toHaveTextContent("Matched");
  });

  it("drops every number from the queue when one is parked", async () => {
    const saved = renderCloze();
    await shownCard();

    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));

    expect(saved.mock.calls[0]?.[1]).toContain("{{c2::Paris::a city}}. !suspended\n");
    expect(await screen.findByTestId("review-done")).toBeInTheDocument();
  });
});
