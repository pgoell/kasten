import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReviewParked } from "@/components/review-parked";
import * as api from "@/lib/api";

/** One suspended card, one unanswered, one in an untagged note, one whole note. */
const HITS = [
  { path: "a.md", line: 1, text: "#flashcards/aws" },
  {
    path: "a.md",
    line: 3,
    text: "What is a VPC?::A private cloud !suspended <!--SR:!2026-08-20,4,270-->",
  },
  { path: "b.md", line: 1, text: "#flashcards/tf" },
  { path: "b.md", line: 3, text: "What is a moved block?::" },
  { path: "c.md", line: 1, text: "Question::" },
  { path: "notes/tls.md", line: 2, text: "sr-suspended: true" },
  { path: "notes/tls.md", line: 6, text: "#review" },
];

const TLS = "---\nsr-due: 2026-08-20\nsr-suspended: true\n---\n# TLS\n\n#review\n";

const NOTES: Record<string, string> = {
  "a.md":
    "#flashcards/aws\n\nWhat is a VPC?::A private cloud !suspended <!--SR:!2026-08-20,4,270-->\n",
  "b.md": "#flashcards/tf\n\nWhat is a moved block?::\n",
  "c.md": "Question::\n",
  "notes/tls.md": TLS,
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

describe("ReviewParked putting a card back", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function saved() {
    return vi.spyOn(api, "saveNote").mockResolvedValue({ path: "a.md", content: "" });
  }

  it("takes the token off the line and leaves the schedule alone", async () => {
    const wrote = saved();
    const { container } = renderParked();
    await screen.findByText("What is a VPC?");

    fireEvent.click(container.querySelector('button[data-unpark="a.md:0"]') as HTMLButtonElement);

    expect(wrote.mock.calls[0]?.[0]).toBe("a.md");
    expect(wrote.mock.calls[0]?.[1]).toContain(
      "What is a VPC?::A private cloud <!--SR:!2026-08-20,4,270-->",
    );
    expect(wrote.mock.calls[0]?.[1]).not.toContain("!suspended");
  });

  it("drops the row it put back", async () => {
    saved();
    const { container } = renderParked();
    await screen.findByText("What is a VPC?");

    fireEvent.click(container.querySelector('button[data-unpark="a.md:0"]') as HTMLButtonElement);

    expect(screen.queryByText("What is a VPC?")).not.toBeInTheDocument();
  });

  it("puts a whole note back through its frontmatter", async () => {
    const wrote = saved();
    const { container } = renderParked();
    await screen.findByText("What is a VPC?");

    fireEvent.click(
      container.querySelector('button[data-unpark="notes/tls.md:0"]') as HTMLButtonElement,
    );

    const written = wrote.mock.calls[0]?.[1] ?? "";
    expect(written).toContain("sr-suspended: false");
    expect(written).toContain("sr-due: 2026-08-20");
    expect(written).not.toContain("!suspended");
  });

  it("draws no put-back control on a question with no answer", async () => {
    const { container } = renderParked();
    await screen.findByText("What is a moved block?");

    // There is no token to take off. Its answer is written in the editor.
    expect(container.querySelector('button[data-unpark="b.md:0"]')).toBeNull();
  });
});
