import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { NotePreview } from "@/components/note-preview";
import { SearchPreview } from "@/components/search-preview";
import type { SearchHit } from "@/lib/api";

const { fetchNote } = vi.hoisted(() => ({ fetchNote: vi.fn() }));
vi.mock("@/lib/api", () => ({ fetchNote }));

const PDF_HIT: SearchHit = {
  path: "docs/Plan.pdf",
  line: 7,
  text: "the budget is due in March",
  place: { kind: "pdf", label: "page 3", page: 3 },
  date: "2026-10-20",
  tags: [],
};

beforeEach(() => {
  fetchNote.mockReset();
  // A note's text is what a file read as a note would show, so the pane
  // would name these lines if the file were fetched as one.
  fetchNote.mockResolvedValue("binary\nstream\nendobj");
});

it("shows the place and the line of a file hit, and does not read the file as a note", async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SearchPreview hit={PDF_HIT} />
    </QueryClientProvider>,
  );

  await waitFor(() => expect(screen.getByTestId("preview").textContent).toContain("page 3"));
  expect(screen.getByTestId("preview").textContent).toContain("the budget is due in March");
  expect(screen.getByTestId("preview").textContent).not.toContain("endobj");
  expect(fetchNote).not.toHaveBeenCalled();
});

describe("#968 the note preview under a hit", () => {
  it("counts the gutter from the window's first line, and marks no line outside it", () => {
    const { container } = render(
      <NotePreview text={"one\ntwo\nthree"} firstLine={10} markLine={20} />,
    );

    const numbers = [...container.querySelectorAll(".cm-lineNumbers .cm-gutterElement")].map(
      (n) => n.textContent,
    );
    expect(numbers).toContain("12");
    expect(numbers).not.toContain("3");
    expect(container.querySelector(".cm-searchHit")).toBeNull();
  });

  it("draws a cloze gap as a pill only when asked, and no gutter without a first line", () => {
    const text = "the \\[answer\\] here";
    const plain = render(<NotePreview text={text} />);
    expect(plain.container.querySelector("[data-gap]")).toBeNull();
    expect(plain.container.querySelector(".cm-lineNumbers")).toBeNull();
    plain.unmount();

    const { container } = render(<NotePreview text={text} gaps />);
    expect(container.querySelector("[data-gap]")).toHaveTextContent("answer");
  });
});
