import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NoteFinder } from "@/components/note-finder";
import { PATHS } from "./note-finder-fixture";

// The finder's own preview asks the api for a note, which is what must not
// happen for a file row, so the api is stood in for and its calls counted.
const { fetchNote } = vi.hoisted(() => ({ fetchNote: vi.fn() }));
vi.mock("@/lib/api", () => ({ fetchNote }));

const FILES = ["docs/plan.pdf", "lit/DDIA.epub", "notes/page.html"];

function renderWithFiles(files: string[] = FILES, vaultNotes: string[] = []) {
  const onOpen = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NoteFinder
        paths={PATHS}
        files={files}
        vaultNotes={vaultNotes}
        onOpen={onOpen}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
  const input = screen.getByLabelText("find note") as HTMLInputElement;
  return {
    onOpen,
    input,
    rows: () => screen.queryAllByRole("option").map((row) => row.textContent),
    option: (path: string) =>
      screen.queryAllByRole("option").find((row) => row.textContent?.startsWith(path)),
    preview: () => screen.queryByTestId("preview")?.textContent,
  };
}

describe("the note finder over files", () => {
  beforeEach(() => {
    fetchNote.mockResolvedValue("# a note");
  });

  afterEach(() => {
    cleanup();
    fetchNote.mockReset();
  });

  it("A1 lists a pdf, an epub and an html file with their kind on the row, and a note with none", () => {
    const finder = renderWithFiles();

    expect(finder.option("docs/plan.pdf")).toHaveTextContent("PDF");
    expect(finder.option("lit/DDIA.epub")).toHaveTextContent("EPUB");
    expect(finder.option("notes/page.html")).toHaveTextContent("HTML");
    // A note's row text is its path and nothing more.
    expect(finder.option("index.md")?.textContent).toBe("index.md");
  });

  it("A3 lists x.md and x.pdf as two rows", () => {
    const finder = renderWithFiles(["index.pdf"]);

    expect(finder.rows().filter((row) => row?.startsWith("index"))).toEqual([
      "index.md",
      "index.pdfPDF",
    ]);
  });

  it("A5 a highlighted pdf row says what it opens in and does not read the file as a note", () => {
    const finder = renderWithFiles();

    // Narrowed to the pdf, so it is the row Enter would open and the preview's subject.
    fireEvent.change(finder.input, { target: { value: "plan" } });

    expect(finder.option("docs/plan.pdf")).toHaveAttribute("aria-selected", "true");
    expect(finder.preview()).toBe("pdf, opens in the pdf pane");
    expect(fetchNote).not.toHaveBeenCalledWith("docs/plan.pdf");
  });

  it("A5 an epub with a note says it opens in the reader, and one without a tab", () => {
    const withNote = renderWithFiles(["lit/DDIA.epub"], ["lit/DDIA.md"]);
    withNote.input.focus();
    fireEvent.change(withNote.input, { target: { value: "ddia" } });
    expect(withNote.preview()).toBe("epub, opens in the reader");
    cleanup();

    const without = renderWithFiles(["lit/DDIA.epub"], []);
    fireEvent.change(without.input, { target: { value: "ddia" } });
    expect(without.preview()).toBe("epub, opens in a new tab");
  });

  it("A5 an html page says it opens as a page", () => {
    const finder = renderWithFiles(["notes/page.html"]);
    fireEvent.change(finder.input, { target: { value: "page" } });

    expect(finder.preview()).toBe("html, opens as a page");
  });
});
