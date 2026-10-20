import { fireEvent, render, screen } from "@testing-library/react";
import { cursor, Harness, press, renderTree } from "./file-explorer-fixture";

describe("images in the tree", () => {
  const IMAGES = ["99 Misc/02 Assets/01 Images/2026-08-12-abcdef01.png"];

  it("draws an image row with its suffix, beside the notes", () => {
    renderTree({ images: IMAGES });

    // The suffix stays: the vault holds one kind of note and five kinds of
    // image, so it is news on this row where `.md` is noise on the others.
    expect(screen.getByText("2026-08-12-abcdef01.png")).toBeInTheDocument();
  });

  it("shows an image rather than opening it as a note, on a click", () => {
    const onOpenFile = vi.fn();
    const onOpenImage = vi.fn();
    renderTree({ images: IMAGES, onOpenFile, onOpenImage });

    fireEvent.click(screen.getByText("2026-08-12-abcdef01.png"));

    expect(onOpenImage).toHaveBeenCalledWith(IMAGES[0]);
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("does the same from the keyboard", () => {
    const onOpenFile = vi.fn();
    const onOpenImage = vi.fn();
    renderTree({ images: IMAGES, onOpenFile, onOpenImage });

    // `99 Misc` sorts ahead of `daily`, so the image is three rows in: the
    // folder, the folder inside it, the folder inside that, then the row.
    press("G");
    press("g");
    press("g");
    press("j");
    press("j");
    press("j");
    press("Enter");

    expect(onOpenImage).toHaveBeenCalledWith(IMAGES[0]);
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("deletes an image rather than trying to delete it as a note, on d", () => {
    const onDeleteImage = vi.fn();
    const onDeleteNote = vi.fn();
    renderTree({ images: IMAGES, onDeleteImage, onDeleteNote });

    press("G");
    press("g");
    press("g");
    press("j");
    press("j");
    press("j");
    press("d");

    expect(onDeleteImage).toHaveBeenCalledWith(IMAGES[0]);
    expect(onDeleteNote).not.toHaveBeenCalled();
  });

  it("A4 marks the image the focused pane is showing as the current row", () => {
    renderTree({ images: IMAGES, openPath: IMAGES[0] });

    expect(screen.getByText("2026-08-12-abcdef01.png").closest("button")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

describe("pdfs in the tree", () => {
  const PDFS = ["x/my plan.pdf"];
  // At the root, where folders sort first and `plan.pdf` after `index`, so `G`
  // lands the cursor on it.
  const ROOT = ["plan.pdf"];

  it("A3 marks the pdf the focused pane is showing as the current row", () => {
    renderTree({ pdfs: PDFS, openPath: PDFS[0] });

    // The suffix stays on the row, as it does on an image's.
    expect(screen.getByText("my plan.pdf").closest("button")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("I1 shows a pdf rather than opening it as a note, on a click", () => {
    const onOpenFile = vi.fn();
    const onOpenPdf = vi.fn();
    renderTree({ pdfs: PDFS, onOpenFile, onOpenPdf });

    fireEvent.click(screen.getByText("my plan.pdf"));

    expect(onOpenPdf).toHaveBeenCalledWith(PDFS[0]);
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("I1 does the same from the keyboard, on Enter", () => {
    const onOpenFile = vi.fn();
    const onOpenPdf = vi.fn();
    renderTree({ pdfs: ROOT, onOpenFile, onOpenPdf });

    press("G");
    press("Enter");

    expect(onOpenPdf).toHaveBeenCalledWith(ROOT[0]);
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("I3 reveals the open pdf the way it reveals an image", () => {
    const { rerender } = render(<Harness pdfs={PDFS} revealSignal={0} />);
    expect(screen.queryByText("my plan.pdf")).toBeNull();

    rerender(<Harness pdfs={PDFS} revealSignal={1} openPath={PDFS[0]} />);

    expect(cursor()).toHaveAttribute("title", PDFS[0]);
  });

  it("leaves a pdf alone on r and d, it being no note to rename or delete", () => {
    const onRenameNote = vi.fn();
    const onDeleteNote = vi.fn();
    const onDeleteImage = vi.fn();
    renderTree({ pdfs: ROOT, onRenameNote, onDeleteNote, onDeleteImage });

    press("G");
    press("r");
    press("d");

    expect(onRenameNote).not.toHaveBeenCalled();
    expect(onDeleteNote).not.toHaveBeenCalled();
    expect(onDeleteImage).not.toHaveBeenCalled();
  });
});

describe("FileExplorer html pages", () => {
  const HTML = ["report.html"];

  it("shows a page rather than opening it as a note, on a click", () => {
    const onOpenFile = vi.fn();
    const onOpenHtml = vi.fn();
    renderTree({ html: HTML, onOpenFile, onOpenHtml });

    fireEvent.click(screen.getByText("report.html"));

    expect(onOpenHtml).toHaveBeenCalledWith("report.html");
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("leaves a page alone on d", () => {
    const onDeleteImage = vi.fn();
    const onDeleteNote = vi.fn();
    renderTree({ html: HTML, onDeleteImage, onDeleteNote });

    // Folders sort first, so the page is the last row.
    press("G");
    press("d");

    expect(onDeleteImage).not.toHaveBeenCalled();
    expect(onDeleteNote).not.toHaveBeenCalled();
  });
});

describe("FileExplorer drag and drop", () => {
  /** What jsdom leaves out of a drag event, and the handlers write to. */
  function transfer() {
    return { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
  }

  function dragOnto(from: string, onto: HTMLElement) {
    const dataTransfer = transfer();
    fireEvent.dragStart(screen.getByText(from), { dataTransfer });
    fireEvent.dragOver(onto, { dataTransfer });
    fireEvent.drop(onto, { dataTransfer });
  }

  it("moves a note into the folder it is dropped on", () => {
    const onMoveRow = vi.fn();
    renderTree({ onMoveRow });

    dragOnto("index", screen.getByText("daily"));

    expect(onMoveRow).toHaveBeenCalledWith("index.md", "rename", "daily/index.md");
  });

  it("moves a folder into another folder", () => {
    const onMoveRow = vi.fn();
    renderTree({ onMoveRow });

    dragOnto("daily", screen.getByText("projects"));

    expect(onMoveRow).toHaveBeenCalledWith("daily", "folder", "projects/daily");
  });

  it("moves a note to the vault root when dropped beside the rows", () => {
    const onMoveRow = vi.fn();
    renderTree({ onMoveRow });

    dragOnto("2026-08-04", screen.getByRole("navigation", { name: "Vault" }));

    expect(onMoveRow).toHaveBeenCalledWith("daily/2026-08-04.md", "rename", "2026-08-04.md");
  });

  it("does nothing for a drop where the note already is", () => {
    const onMoveRow = vi.fn();
    renderTree({ onMoveRow });

    dragOnto("index", screen.getByRole("navigation", { name: "Vault" }));

    expect(onMoveRow).not.toHaveBeenCalled();
  });

  it("does nothing for a folder dropped on itself", () => {
    const onMoveRow = vi.fn();
    renderTree({ onMoveRow });

    dragOnto("daily", screen.getByText("daily"));

    expect(onMoveRow).not.toHaveBeenCalled();
  });

  it("does not drag a page", () => {
    renderTree({ html: ["report.html"] });

    expect(screen.getByText("report.html").closest("button")).toHaveAttribute("draggable", "false");
  });
});
