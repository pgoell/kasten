import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { NoteFinder } from "@/components/finder/note-finder";

// Sorted the way the backend serves it.
export const PATHS = [
  "daily/2026-08-05.md",
  "index.md",
  "projects/kasten.md",
  "projects/kasten/api-design.md",
];

// Twenty-five notes, five more than the list will mount, so the cap has
// something to cut. The `notes-` five sort last of the twenty-five and rank
// first against `no`, because the query opens their name rather than landing
// mid-way through it. So rank-then-cut and cut-then-rank disagree on this
// vault, which is what makes the assertion below able to fail.
export const MANY_PATHS = [
  ...Array.from(
    { length: 20 },
    (_, index) => `archive-notes-${String(index).padStart(2, "0")}/entry.md`,
  ),
  ...Array.from({ length: 5 }, (_, index) => `notes-${index}.md`),
];

export function renderFinder(vault = PATHS, queryClient = new QueryClient()) {
  const onOpen = vi.fn();
  const onClose = vi.fn();

  render(
    <QueryClientProvider client={queryClient}>
      <NoteFinder paths={vault} onOpen={onOpen} onClose={onClose} />
    </QueryClientProvider>,
  );

  const input = screen.getByLabelText("find note") as HTMLInputElement;

  return {
    input,
    onOpen,
    onClose,
    queryClient,
    preview: () => screen.getByTestId("preview").textContent,
    type: (value: string) => fireEvent.change(input, { target: { value } }),
    // `fireEvent` returns false when a handler called `preventDefault`, which
    // is how a test pins that the browser's own answer to the key never ran.
    press: (key: string, init?: KeyboardEventInit) => fireEvent.keyDown(input, { key, ...init }),
    rows: () => screen.queryAllByRole("option").map((row) => row.textContent),
    highlighted: () => screen.queryByRole("option", { selected: true })?.textContent,
    hint: () => screen.getByRole("status").textContent,
  };
}
