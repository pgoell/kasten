import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { NoteSearch } from "@/components/note-search";
import { NOW, renderContent, searchHooks } from "./content-search-fixture";
import { COARSE, NARROW, stubMatchMedia } from "./match-media";

const { searchNotes, fetchNote, fetchTodos, fetchMentions } = vi.hoisted(() => ({
  searchNotes: vi.fn(),
  fetchNote: vi.fn(),
  fetchTodos: vi.fn(),
  fetchMentions: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ searchNotes, fetchNote, fetchTodos, fetchMentions }));

searchHooks();

afterEach(() => {
  vi.unstubAllGlobals();
});

it("sets the query in the serif face at the display size", () => {
  const search = renderContent();

  expect(search.input.className).toContain("font-serif");
  expect(search.input.className).toContain("text-k-36");
  expect(search.input.placeholder).toBe("Search the vault");
});

it("keeps the arrow keys and Enter working after a bar is clicked", async () => {
  const search = renderContent();

  search.type("postgres");
  await waitFor(() => expect(search.rows()).toHaveLength(2));
  fireEvent.click(search.bar(38));
  search.press("ArrowDown");
  search.press("Enter");

  expect(search.onOpen).toHaveBeenCalledWith("reference/deploy.md", 88);
});

it("does not take the focus from the input on a press of a bar", () => {
  const search = renderContent();

  // A prevented mousedown is what keeps the focus on the input.
  expect(fireEvent.mouseDown(search.bar(38))).toBe(false);
});

it("makes a bar, a filter and a line 44 pixels tall under a finger", async () => {
  const search = renderContent();

  search.type("postgres");
  await waitFor(() => expect(search.rows()).toHaveLength(2));

  expect(search.bar(38).className).toContain("pointer-coarse:min-h-11");
  expect(screen.getByRole("button", { name: /^projects/ }).className).toContain(
    "pointer-coarse:min-h-11",
  );
  expect(search.row(0).className).toContain("pointer-coarse:min-h-11");
});

it("folds the filter column into a Filters button on a phone, opened by a press", () => {
  stubMatchMedia({ [NARROW]: true, [COARSE]: true });
  renderContent();

  expect(screen.queryByRole("complementary", { name: "Filters" })).toBeNull();
  expect(screen.queryByRole("group", { name: "Folders" })).toBeNull();

  const filters = screen.getByRole("button", { name: "Filters" });
  fireEvent.click(filters);

  expect(filters.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("group", { name: "Folders" })).toBeTruthy();
});

it("gives the focus back to where it was when Escape closes the search page", () => {
  // A host that mounts the page on a press and unmounts it on Escape, the way the
  // route does, so the page's own cleanup is what gives the focus back.
  function Host() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          opener
        </button>
        {open && (
          <NoteSearch onOpen={() => {}} onClose={() => setOpen(false)} archive={false} now={NOW} />
        )}
      </>
    );
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Host />
    </QueryClientProvider>,
  );
  const opener = screen.getByRole("button", { name: "opener" });
  opener.focus();
  fireEvent.click(opener);
  expect(document.activeElement).toBe(screen.getByLabelText("search notes"));

  fireEvent.keyDown(screen.getByLabelText("search notes"), { key: "Escape" });

  expect(screen.queryByRole("dialog", { name: "Search notes" })).toBeNull();
  expect(document.activeElement).toBe(opener);
});

it("presses a focused bar on Enter rather than opening the highlighted line", async () => {
  const search = renderContent();

  search.type("postgres");
  await waitFor(() => expect(search.rows()).toHaveLength(2));
  const bar = search.bar(38);
  bar.focus();
  // A browser presses a focused button on Enter unless the keydown is prevented.
  if (fireEvent.keyDown(bar, { key: "Enter" })) fireEvent.click(bar);

  expect(search.onOpen).not.toHaveBeenCalled();
  expect(bar.getAttribute("aria-pressed")).toBe("true");
});

it("names the chosen folder on the Filters button while the column is shut", async () => {
  stubMatchMedia({ [NARROW]: true, [COARSE]: true });
  const search = renderContent();

  search.type("postgres");
  await waitFor(() => expect(search.rows()).toHaveLength(2));
  fireEvent.click(screen.getByRole("button", { name: "Filters" }));
  fireEvent.click(screen.getByRole("button", { name: /^projects/ }));
  fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));

  expect(screen.getByRole("button", { name: "Filters, projects" })).toBeTruthy();
});

it("draws no rule under the page when the status line says nothing", async () => {
  const search = renderContent();

  search.type("postgres");
  await waitFor(() => expect(search.rows()).toHaveLength(2));

  expect(search.hint()).toBe("");
  expect(screen.getByRole("status").className).not.toContain("border-t");
});
