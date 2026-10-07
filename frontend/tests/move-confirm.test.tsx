import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MoveConfirm } from "@/components/move-confirm";

// Standing in for the module, for the reason `note-prompt.test.tsx` gives.
const { previewMove, renameNote, moveFolder } = vi.hoisted(() => ({
  previewMove: vi.fn(),
  renameNote: vi.fn(),
  moveFolder: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ previewMove, renameNote, moveFolder }));

function renderConfirm(mode: "rename" | "folder" = "rename") {
  const onMoved = vi.fn();
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MoveConfirm
        mode={mode}
        startPath={mode === "rename" ? "inbox/borges.md" : "inbox"}
        target={mode === "rename" ? "reading/borges.md" : "archive/inbox"}
        onMoved={onMoved}
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
  return { onMoved, onClose };
}

beforeEach(() => {
  previewMove.mockReset();
  renameNote.mockReset();
  moveFolder.mockReset();
});

it("lists the files the move rewrites", async () => {
  previewMove.mockResolvedValue(["home.md", "inbox/index.md"]);
  renderConfirm();

  expect(await screen.findByText("updates links in 2 files, Enter moves")).toBeInTheDocument();
  expect(screen.getByText("home.md")).toBeInTheDocument();
  expect(previewMove).toHaveBeenCalledWith("inbox/borges.md", "reading/borges.md");
});

it("moves the note on Enter", async () => {
  previewMove.mockResolvedValue([]);
  renameNote.mockResolvedValue({ path: "reading/borges.md", content: "# borges" });
  const { onMoved } = renderConfirm();

  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });

  await waitFor(() => expect(onMoved).toHaveBeenCalledWith("reading/borges.md"));
  expect(renameNote).toHaveBeenCalledWith("inbox/borges.md", "reading/borges.md");
});

it("moves a folder through the folder route", async () => {
  previewMove.mockResolvedValue([]);
  moveFolder.mockResolvedValue({ path: "archive/inbox" });
  const { onMoved } = renderConfirm("folder");

  fireEvent.click(screen.getByRole("button", { name: "Move" }));

  await waitFor(() => expect(onMoved).toHaveBeenCalledWith("archive/inbox"));
});

it("moves nothing on Escape", () => {
  previewMove.mockResolvedValue([]);
  const { onClose } = renderConfirm();

  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

  expect(onClose).toHaveBeenCalled();
  expect(renameNote).not.toHaveBeenCalled();
});

it("says so when the vault refuses the move", async () => {
  previewMove.mockResolvedValue([]);
  renameNote.mockRejectedValue(new Error("409"));
  renderConfirm();

  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Enter" });

  expect(await screen.findByText("could not move it, Esc closes")).toBeInTheDocument();
});
