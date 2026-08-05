import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
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

const DEFAULT_WIDTH = "256px";

/** Notes are buttons too, so `expanded` is what tells a folder apart from one. */
function folderContents(name: string) {
  const row = screen.getByRole("button", { name, expanded: true });
  const item = row.closest("li");
  if (!item) throw new Error(`No list item around the folder ${name}`);
  return within(item);
}

function renderTree(props: Partial<ComponentProps<typeof FileExplorer>> = {}) {
  return render(<FileExplorer paths={PATHS} onOpenFile={() => {}} {...props} />);
}

function panel() {
  return screen.getByRole("complementary");
}

function grip() {
  return screen.getByRole("separator", { name: "Resize file tree" });
}

/** Press the grip at `from`, move the pointer to `to`, let go. */
function dragGrip(from: number, to: number) {
  fireEvent.pointerDown(grip(), { clientX: from });
  fireEvent.pointerMove(window, { clientX: to });
  fireEvent.pointerUp(window);
}

describe("FileExplorer", () => {
  it("nests each note under the folders in its path", () => {
    renderTree();

    expect(folderContents("daily").getByText("2026-08-05")).toBeInTheDocument();
    expect(folderContents("kasten").getByText("api-design")).toBeInTheDocument();
  });

  it("keeps a note and a folder of the same name apart", () => {
    renderTree();

    const projects = folderContents("projects");

    expect(projects.getByRole("button", { name: "kasten", expanded: true })).toBeInTheDocument();
    expect(projects.getByTitle("projects/kasten.md")).toBeInTheDocument();
  });

  it("hands back the path of the note that was clicked", () => {
    const onOpenFile = vi.fn();
    renderTree({ onOpenFile });

    fireEvent.click(screen.getByText("api-design"));

    expect(onOpenFile).toHaveBeenCalledWith("projects/kasten/api-design.md");
  });

  it("opens the note, not the folder, when the two share a name", () => {
    const onOpenFile = vi.fn();
    renderTree({ onOpenFile });

    fireEvent.click(screen.getByTitle("projects/kasten.md"));

    expect(onOpenFile).toHaveBeenCalledWith("projects/kasten.md");
  });

  it("marks the open note and leaves the rest unmarked", () => {
    renderTree({ openPath: "projects/kasten.md" });

    expect(screen.getByTitle("projects/kasten.md")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTitle("index.md")).not.toHaveAttribute("aria-current");
  });

  it("marks nothing while no note is open", () => {
    renderTree();

    expect(screen.queryByRole("button", { current: "page" })).toBeNull();
  });

  it("lists notes at the vault root outside any folder", () => {
    renderTree();

    expect(screen.getByText("index")).toBeInTheDocument();
    expect(folderContents("daily").queryByText("index")).toBeNull();
  });

  it("hides a folder's notes once it is collapsed, and brings them back", () => {
    renderTree();

    fireEvent.click(screen.getByRole("button", { name: "daily" }));

    expect(screen.queryByText("2026-08-04")).toBeNull();
    expect(screen.getByText("index")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "daily" }));

    expect(screen.getByText("2026-08-04")).toBeInTheDocument();
  });

  it("folds the whole panel away and back", () => {
    renderTree();

    fireEvent.click(screen.getByRole("button", { name: "Hide file tree" }));

    expect(screen.queryByText("index")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show file tree" }));

    expect(screen.getByText("index")).toBeInTheDocument();
  });

  it("says the vault is empty rather than showing nothing", () => {
    renderTree({ paths: [] });

    expect(screen.getByText("No notes yet")).toBeInTheDocument();
  });

  it("resizes the panel by dragging its grip", () => {
    renderTree();

    dragGrip(256, 340);
    expect(panel()).toHaveStyle({ width: "340px" });

    dragGrip(340, 300);
    expect(panel()).toHaveStyle({ width: "300px" });
  });

  it("keeps the panel between its minimum and maximum width", () => {
    renderTree();

    dragGrip(256, 0);
    expect(panel()).toHaveStyle({ width: "160px" });

    dragGrip(160, 2000);
    expect(panel()).toHaveStyle({ width: "480px" });
  });

  it("stops resizing once the pointer is released", () => {
    renderTree();

    dragGrip(256, 340);
    fireEvent.pointerMove(window, { clientX: 200 });

    expect(panel()).toHaveStyle({ width: "340px" });
  });

  it("resets to the default width on a double click", () => {
    renderTree();

    dragGrip(256, 400);
    fireEvent.doubleClick(grip());

    expect(panel()).toHaveStyle({ width: DEFAULT_WIDTH });
  });

  it("resizes with the arrow keys", () => {
    renderTree();

    fireEvent.keyDown(grip(), { key: "ArrowRight" });
    expect(panel()).toHaveStyle({ width: "272px" });

    fireEvent.keyDown(grip(), { key: "ArrowLeft" });
    expect(panel()).toHaveStyle({ width: DEFAULT_WIDTH });
  });

  it("folds the panel away and back on ctrl+b, wherever the focus sits", () => {
    renderTree();

    fireEvent.keyDown(document.body, { key: "b", ctrlKey: true });
    expect(screen.queryByText("index")).toBeNull();

    fireEvent.keyDown(document.body, { key: "b", metaKey: true });
    expect(screen.getByText("index")).toBeInTheDocument();
  });
});
