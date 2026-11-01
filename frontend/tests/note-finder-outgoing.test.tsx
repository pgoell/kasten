import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { NoteFinder } from "@/components/finder/note-finder";

// The api module builds its client at import time and captures `fetch` there,
// so stubbing the global afterwards would never be seen. Standing in for the
// module is also the right level: what this component owns is which note it
// asks for and how often, not the HTTP.
const { fetchNote } = vi.hoisted(() => ({ fetchNote: vi.fn() }));
vi.mock("@/lib/api", () => ({ fetchNote }));

describe("the outgoing links panel", () => {
  beforeEach(() => {
    fetchNote.mockResolvedValue("# a note");
  });

  afterEach(() => {
    fetchNote.mockReset();
  });

  function renderLinksOut(links: string[]) {
    const onOpen = vi.fn();

    render(
      <QueryClientProvider client={new QueryClient()}>
        <NoteFinder paths={links} outgoing onOpen={onOpen} onClose={vi.fn()} />
      </QueryClientProvider>,
    );

    const input = screen.getByLabelText("links out") as HTMLInputElement;

    return {
      onOpen,
      type: (value: string) => fireEvent.change(input, { target: { value } }),
      press: (key: string) => fireEvent.keyDown(input, { key }),
      rows: () => screen.queryAllByRole("option").map((row) => row.textContent),
      hint: () => screen.getByRole("status").textContent,
    };
  }

  it("names the dialog for the links it holds", () => {
    renderLinksOut(["index.md"]);

    expect(screen.getByRole("dialog", { name: "Outgoing links" })).toBeTruthy();
  });

  it("lists the notes it was handed rather than the vault", () => {
    const panel = renderLinksOut(["index.md", "projects/kasten.md"]);

    expect(panel.rows()).toEqual(["index.md", "projects/kasten.md"]);
  });

  it("narrows and opens the way the finder does", () => {
    const panel = renderLinksOut(["index.md", "projects/kasten.md"]);

    panel.type("kas");
    panel.press("Enter");

    expect(panel.onOpen).toHaveBeenCalledWith("projects/kasten.md");
  });

  it("says the note links nowhere rather than that the vault is empty", () => {
    // Two emptinesses, and saying the wrong one about a full vault is the whole
    // reason the panel is told which list it is holding.
    const panel = renderLinksOut([]);

    expect(panel.hint()).toBe("this note links nowhere");
  });
});
