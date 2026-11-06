import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { useReadingBook } from "@/components/finder/use-reading-book";
import { READING_NOTE } from "@/lib/core/layout";
import {
  emptyLayout,
  fillFocused,
  focusedPane,
  focusPane,
  splitFocused,
  tabPanes,
} from "@/lib/panes/layout/panes";

const api = vi.hoisted(() => ({ fetchNote: vi.fn() }));
vi.mock("@/lib/core/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/api")>()),
  fetchNote: api.fetchNote,
}));

/** The reading-book command, reached through its own module, over cached listings. */
function readingBook(saveFirst: () => Promise<boolean>, paneId = "unused") {
  const client = new QueryClient();
  client.setQueryData(["files"], ["books/Dune.md"]);
  client.setQueryData(["assets"], ["books/Dune.epub"]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const moveTo = vi.fn();
  const setNotice = vi.fn();
  const { result } = renderHook(() => useReadingBook({ paneId, saveFirst, moveTo, setNotice }), {
    wrapper,
  });
  return { openReadingBook: result.current, moveTo, setNotice };
}

it("#981 opens the book the reading note links, after the save", async () => {
  api.fetchNote.mockResolvedValue("[[Dune]]");
  const start = emptyLayout("notes/a.md");
  const { openReadingBook, moveTo } = readingBook(async () => true, focusedPane(start).id);

  await openReadingBook();

  expect(api.fetchNote).toHaveBeenCalledWith(READING_NOTE);
  const next = moveTo.mock.calls[0]?.[0](start);
  expect(focusedPane(next).book).toBe("books/Dune.md");
});

it("#981 a refused save reads nothing and moves nothing", async () => {
  api.fetchNote.mockClear();
  const { openReadingBook, moveTo } = readingBook(async () => false);

  await openReadingBook();

  expect(api.fetchNote).not.toHaveBeenCalled();
  expect(moveTo).not.toHaveBeenCalled();
});

it("#1626 fills the pane it was pressed in when the focus moves right during the save", async () => {
  api.fetchNote.mockResolvedValue("[[Dune]]");
  const split = fillFocused(splitFocused(emptyLayout("notes/a.md"), "row"), { path: "notes/b.md" });
  const [left, right] = tabPanes(split);
  const { openReadingBook, moveTo } = readingBook(async () => true, left?.id);

  await openReadingBook();

  const next = moveTo.mock.calls[0]?.[0](focusPane(split, right?.id ?? ""));
  expect(tabPanes(next)).toEqual([{ id: left?.id, book: "books/Dune.md" }, right]);
  expect(focusedPane(next)).toEqual(right);
});
