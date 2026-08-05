import { fireEvent, render, screen, within } from "@testing-library/react";
import { FileExplorer } from "@/components/file-explorer";

// Sorted the way the backend serves it. `projects/kasten.md` and the folder
// `projects/kasten/` share a name on purpose: the vault allows both.
const PATHS = [
  "daily/2026-08-04.md",
  "daily/2026-08-05.md",
  "index.md",
  "projects/kasten.md",
  "projects/kasten/api-design.md",
];

function folderContents(name: string) {
  const row = screen.getByRole("button", { name });
  const item = row.closest("li");
  if (!item) throw new Error(`No list item around the folder ${name}`);
  return within(item);
}

describe("FileExplorer", () => {
  it("nests each note under the folders in its path", () => {
    render(<FileExplorer paths={PATHS} />);

    expect(folderContents("daily").getByText("2026-08-05")).toBeInTheDocument();
    expect(folderContents("kasten").getByText("api-design")).toBeInTheDocument();
  });

  it("keeps a note and a folder of the same name apart", () => {
    render(<FileExplorer paths={PATHS} />);

    const projects = folderContents("projects");

    expect(projects.getByRole("button", { name: "kasten" })).toBeInTheDocument();
    expect(projects.getByTitle("projects/kasten.md")).toBeInTheDocument();
  });

  it("lists notes at the vault root outside any folder", () => {
    render(<FileExplorer paths={PATHS} />);

    expect(screen.getByText("index")).toBeInTheDocument();
    expect(folderContents("daily").queryByText("index")).toBeNull();
  });

  it("hides a folder's notes once it is collapsed, and brings them back", () => {
    render(<FileExplorer paths={PATHS} />);

    fireEvent.click(screen.getByRole("button", { name: "daily" }));

    expect(screen.queryByText("2026-08-04")).toBeNull();
    expect(screen.getByText("index")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "daily" }));

    expect(screen.getByText("2026-08-04")).toBeInTheDocument();
  });

  it("folds the whole panel away and back", () => {
    render(<FileExplorer paths={PATHS} />);

    fireEvent.click(screen.getByRole("button", { name: "Hide file tree" }));

    expect(screen.queryByText("index")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show file tree" }));

    expect(screen.getByText("index")).toBeInTheDocument();
  });

  it("says the vault is empty rather than showing nothing", () => {
    render(<FileExplorer paths={[]} />);

    expect(screen.getByText("No notes yet")).toBeInTheDocument();
  });
});
