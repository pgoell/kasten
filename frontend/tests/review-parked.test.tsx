import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { ReviewParked } from "@/components/review-parked";
import * as api from "@/lib/api";

/** One suspended card, one unanswered, one in an untagged note, one whole note. */
const HITS = [
  { path: "a.md", line: 1, text: "#flashcards/aws" },
  { path: "a.md", line: 3, text: "What is a VPC?::A private cloud !suspended" },
  { path: "b.md", line: 1, text: "#flashcards/tf" },
  { path: "b.md", line: 3, text: "What is a moved block?::" },
  { path: "c.md", line: 1, text: "Question::" },
  { path: "notes/tls.md", line: 2, text: "sr-suspended: true" },
  { path: "notes/tls.md", line: 6, text: "#review" },
];

const NOTES: Record<string, string> = {
  "a.md": "#flashcards/aws\n\nWhat is a VPC?::A private cloud !suspended\n",
  "b.md": "#flashcards/tf\n\nWhat is a moved block?::\n",
  "c.md": "Question::\n",
  "notes/tls.md": "---\nsr-suspended: true\n---\n# TLS\n\n#review\n",
};

function renderParked() {
  vi.spyOn(api, "fetchCards").mockResolvedValue(HITS);
  vi.spyOn(api, "fetchNote").mockImplementation((path: string) =>
    Promise.resolve(NOTES[path] ?? ""),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ReviewParked onLeave={vi.fn()} onOpen={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("ReviewParked", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("lists a card parked by its token", async () => {
    renderParked();

    expect(await screen.findByText("What is a VPC?")).toBeInTheDocument();
  });

  it("lists a question with no answer", async () => {
    renderParked();

    expect(await screen.findByText("What is a moved block?")).toBeInTheDocument();
  });

  it("lists a suspended note under its own name", async () => {
    const { container } = renderParked();
    await screen.findByText("What is a VPC?");

    // The note is the card here, so the row is its name and its deck is itself.
    const row = container.querySelector('button[data-parked="notes/tls.md:0"]');
    expect(row).toHaveTextContent("tls");
  });

  it("draws no row for a divider in a note nobody tagged", async () => {
    const { container } = renderParked();
    await screen.findByText("What is a VPC?");

    expect(container.querySelectorAll("button[data-parked]")).toHaveLength(3);
    expect(screen.queryByText("Question")).not.toBeInTheDocument();
  });

  it("says why each one is parked", async () => {
    renderParked();
    await screen.findByText("What is a VPC?");

    // The card carrying the token and the note its frontmatter parks.
    expect(screen.getAllByText("suspended")).toHaveLength(2);
    expect(screen.getByText("unanswered")).toBeInTheDocument();
  });
});
