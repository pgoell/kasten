import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LibraryPane } from "@/components/books/library-pane";
import { stubCommands } from "../stub-commands";

// The modules, not `fetch`: what the pane owns is what it asks the vault for and writes back.
const { fetchLibrary, fetchFiles, fetchNote, updateNote, createNote, moveAndCache } = vi.hoisted(
  () => ({
    fetchLibrary: vi.fn(),
    fetchFiles: vi.fn(),
    fetchNote: vi.fn(),
    updateNote: vi.fn(),
    createNote: vi.fn(),
    moveAndCache: vi.fn(),
  }),
);
vi.mock("@/components/books/library", async (actual) => ({
  ...(await actual<typeof import("@/components/books/library")>()),
  fetchLibrary,
}));
vi.mock("@/lib/core/api", async (actual) => ({
  ...(await actual<typeof import("@/lib/core/api")>()),
  fetchFiles,
  fetchNote,
  updateNote,
  createNote,
}));
vi.mock("@/lib/vault/move/move", () => ({ moveAndCache }));

const base = {
  author: "An Author",
  chosen: false,
  progress: null,
  read_at: null,
  created: null,
  hidden: false,
  highlights: 0,
  current: false,
  format: "epub" as const,
};
const BOOKS = [
  {
    ...base,
    path: "Books/01 Tech/DDIA.md",
    title: "DDIA",
    folder: "Books/01 Tech",
    status: "reading" as const,
    progress: 0.42,
    read_at: "2026-11-05T10:00:00+00:00",
    highlights: 1,
  },
  {
    ...base,
    path: "Books/02 Kids/Home.md",
    title: "Home",
    folder: "Books/02 Kids",
    status: "unread" as const,
  },
  {
    ...base,
    path: "Books/02 Kids/Gone.md",
    title: "Gone",
    folder: "Books/02 Kids",
    status: "unread" as const,
    hidden: true,
  },
];
const DDIA =
  "---\ntype: Book\n---\n# DDIA\n\n## Highlights\n\n> A quote\n\nChapter one ^hl-4bab26\n";

beforeEach(() => {
  for (const mock of [fetchLibrary, fetchFiles, fetchNote, updateNote, createNote, moveAndCache]) {
    mock.mockReset();
  }
  fetchLibrary.mockResolvedValue(BOOKS);
  fetchFiles.mockResolvedValue(BOOKS.map((each) => each.path));
  fetchNote.mockResolvedValue(DDIA);
  updateNote.mockResolvedValue(null);
});

function open() {
  const props = { onRead: vi.fn(), onOpen: vi.fn(), onNotice: vi.fn() };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LibraryPane
        commands={stubCommands()}
        focusSignal={1}
        today={new Date("2026-11-06T12:00:00")}
        {...props}
      />
    </QueryClientProvider>,
  );
  return props;
}

function press(key: string) {
  const pane = document.querySelector("[data-library-pane]");
  if (pane === null) throw new Error("no library pane");
  fireEvent.keyDown(pane, { key });
}

it("lists books by group and shows the first with its highlights", async () => {
  open();

  expect(await screen.findByRole("heading", { name: "DDIA" })).toBeTruthy();
  expect(screen.getByRole("listbox", { name: "Reading" })).toBeTruthy();
  expect(screen.getByRole("listbox", { name: "Up next" })).toBeTruthy();
  expect(screen.queryByText("Gone")).toBeNull();
  expect(await screen.findByText("A quote")).toBeTruthy();
  expect(screen.getByText("Chapter one")).toBeTruthy();
});

it("reads, opens and moves the cursor from the keys", async () => {
  const props = open();
  await screen.findByRole("heading", { name: "DDIA" });

  press("Enter");
  expect(props.onRead).toHaveBeenCalledWith("Books/01 Tech/DDIA.md");
  press("j");
  expect(await screen.findByRole("heading", { name: "Home" })).toBeTruthy();
  press("o");
  expect(props.onOpen).toHaveBeenCalledWith("Books/02 Kids/Home.md");
});

it("hides a book with x and shows hidden ones with the toggle", async () => {
  open();
  await screen.findByRole("heading", { name: "DDIA" });

  press("x");
  await waitFor(() => expect(updateNote).toHaveBeenCalled());
  const [path, change] = updateNote.mock.calls[0] as [string, (text: string) => string];
  expect(path).toBe("Books/01 Tech/DDIA.md");
  expect(change("---\ntype: Book\n---\n")).toContain("hidden: true");

  press(".");
  expect(await screen.findByText("Gone")).toBeTruthy();
});

it("steps the status with s and moves to a shelf with m and a digit", async () => {
  moveAndCache.mockResolvedValue("Books/02 Kids/DDIA.md");
  open();
  await screen.findByRole("heading", { name: "DDIA" });

  press("s");
  await waitFor(() => expect(updateNote).toHaveBeenCalled());
  const change = updateNote.mock.calls[0]?.[1] as (text: string) => string;
  expect(change("---\ntype: Book\n---\n")).toContain("status: finished");

  press("m");
  press("1");
  await waitFor(() =>
    expect(moveAndCache).toHaveBeenCalledWith(
      expect.anything(),
      "rename",
      "Books/01 Tech/DDIA.md",
      "Books/02 Kids/DDIA.md",
    ),
  );
});

it("names the book in the current-book note with r", async () => {
  const props = open();
  await screen.findByRole("heading", { name: "DDIA" });

  press("r");
  await waitFor(() => expect(props.onNotice).toHaveBeenCalledWith("DDIA is the current book"));
  const change = updateNote.mock.calls[0]?.[1] as (text: string) => string;
  expect(change("Now: [[Old]]\n")).toBe("Now: [[DDIA]]\n");
});
