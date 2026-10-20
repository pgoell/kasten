import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { NotePrompt, type PromptMode } from "@/components/note-prompt";

// The test files beside this one mock the api modules at this level:
// The api module builds its client at import time and captures `fetch` there,
// so stubbing the global afterwards would never be seen. Standing in for the
// module is also the right level: what this component owns is the path it sends
// and what it does with the answer, not the HTTP.

// Sorted the way the backend serves it, and holding three folders: `daily/`,
// `projects/` and `projects/kasten/`.
export const PATHS = [
  "daily/2026-08-05.md",
  "index.md",
  "projects/kasten.md",
  "projects/kasten/api-design.md",
];

// Twenty-five folders, five more than the list will mount, so the cap has
// something to cut. The `notes-` five sort last of the twenty-five and rank
// first against `no`, because the query opens their name rather than landing
// mid-way through it. So rank-then-cut and cut-then-rank disagree on this
// vault, which is what makes the assertion below able to fail.
export const MANY_PATHS = [
  ...Array.from(
    { length: 20 },
    (_, index) => `archive-notes-${String(index).padStart(2, "0")}/entry.md`,
  ),
  ...Array.from({ length: 5 }, (_, index) => `notes-${index}/entry.md`),
];

/** What the input is labelled in each of the three modes. */
const LABEL: Record<PromptMode, string> = {
  create: "new note",
  rename: "rename note",
  folder: "rename folder",
};

export function renderPrompt(
  startPath = "",
  vault = PATHS,
  mode: PromptMode = "create",
  openNote?: string,
) {
  const onOpen = vi.fn();
  const onClose = vi.fn();
  const queryClient = new QueryClient();

  const tree = (paths: string[]) => (
    <QueryClientProvider client={queryClient}>
      <NotePrompt
        mode={mode}
        paths={paths}
        startPath={startPath}
        openNote={openNote}
        onOpen={onOpen}
        onClose={onClose}
      />
    </QueryClientProvider>
  );

  const { rerender, unmount } = render(tree(vault));
  const input = screen.getByLabelText(LABEL[mode]) as HTMLInputElement;

  return {
    input,
    onOpen,
    onClose,
    queryClient,
    unmount,
    type: (value: string) => fireEvent.change(input, { target: { value } }),
    // `fireEvent` returns false when a handler called `preventDefault`, which
    // is how a test pins that the browser's own answer to the key never ran.
    press: (key: string, init?: KeyboardEventInit) => fireEvent.keyDown(input, { key, ...init }),
    /** A fresh listing from the tree, which the prompt takes as a prop. */
    setPaths: (paths: string[]) => rerender(tree(paths)),
    row: (folder: string) => screen.getByText(folder),
    rows: () => screen.queryAllByRole("option").map((row) => row.textContent),
    highlighted: () => screen.getByRole("option", { selected: true }).textContent,
    hint: () => screen.getByRole("status").textContent,
  };
}
