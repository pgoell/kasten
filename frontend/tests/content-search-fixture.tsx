import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { NoteSearch } from "@/components/note-search";
import type { SearchHit } from "@/lib/api";
import { fetchMentions, searchNotes } from "@/lib/api";

// The test files beside this one mock the api module at this level, the way the
// note search's do: what the page owns is what it asks the vault for and how
// often, not the HTTP underneath.

/** Today: a Friday in week 43, so the bars run from week 30 to week 43. */
export const NOW = new Date(2026, 9, 23);

/** A note's lines, `count` of them, each on its own line and dated `date`. */
export function lines(path: string, count: number, date: string, text = "postgres"): SearchHit[] {
  return Array.from({ length: count }, (_, at) => ({
    path,
    line: at + 1,
    text: `${text} line ${at + 1}`,
    date,
    tags: [],
  }));
}

/** The answer to any query, unless a test says otherwise. Week 43 and week 38, one line each. */
export const HITS: SearchHit[] = [
  {
    path: "projects/kasten.md",
    line: 12,
    text: "Postgres holds a derived index.",
    date: "2026-10-20",
    tags: ["#db"],
  },
  {
    path: "reference/deploy.md",
    line: 88,
    text: "postgres runs in its own container",
    date: "2026-09-16",
    tags: ["#reading"],
  },
];

/** What the archive holds beside `HITS`, which only the archive-in answer carries. */
export const ARCHIVED: SearchHit[] = [
  {
    path: "98 Archive/old.md",
    line: 3,
    text: "postgres in the old plan",
    date: "2026-10-01",
    tags: ["#db"],
  },
];

/** Resets the fakes before each test: the archive-out answer is `HITS`, the archive-in one adds `ARCHIVED`. */
export function searchHooks() {
  beforeEach(() => {
    vi.mocked(searchNotes).mockReset();
    vi.mocked(searchNotes).mockImplementation(async (_query: string, archive?: boolean) =>
      archive ? [...HITS, ...ARCHIVED] : HITS,
    );
    vi.mocked(fetchMentions).mockReset();
    vi.mocked(fetchMentions).mockResolvedValue([]);
  });
}

/** Mounts the search over `NOW`, holding the week and the archive the way the route does. */
export function renderContent({
  week,
  archive = false,
  onOpen = vi.fn(),
  onClose = vi.fn(),
  onWeek = vi.fn(),
  onToggleArchive = vi.fn(),
}: {
  week?: string;
  archive?: boolean;
  onOpen?: (path: string, line: number) => void;
  onClose?: () => void;
  onWeek?: (week: string | undefined) => void;
  onToggleArchive?: () => void;
} = {}) {
  function Harness() {
    const [current, setCurrent] = useState<string | undefined>(week);
    const [inArchive, setInArchive] = useState(archive);
    return (
      <NoteSearch
        onOpen={onOpen}
        onClose={onClose}
        now={NOW}
        week={current}
        onWeek={(next) => {
          onWeek(next);
          setCurrent(next);
        }}
        archive={inArchive}
        onToggleArchive={() => {
          onToggleArchive();
          setInArchive((on) => !on);
        }}
      />
    );
  }

  render(
    <QueryClientProvider client={new QueryClient()}>
      <Harness />
    </QueryClientProvider>,
  );

  const input = screen.getByLabelText("search notes") as HTMLInputElement;

  return {
    input,
    onOpen,
    onClose,
    onWeek,
    onToggleArchive,
    type: (value: string) => fireEvent.change(input, { target: { value } }),
    press: (key: string, init?: KeyboardEventInit) => fireEvent.keyDown(input, { key, ...init }),
    rows: () => screen.queryAllByRole("option").map((row) => row.textContent),
    row: (at: number) => screen.getAllByRole("option")[at] as HTMLElement,
    /** The fourteen bars, oldest first. */
    bars: () => screen.queryAllByRole("button", { name: /^Week \d+,/ }) as HTMLElement[],
    bar: (week: number) =>
      screen.getByRole("button", { name: new RegExp(`^Week ${week},`) }) as HTMLElement,
    /** The coloured block inside a bar, whose height is the count. */
    fill: (week: number) =>
      screen
        .getByRole("button", { name: new RegExp(`^Week ${week},`) })
        .querySelector<HTMLElement>('[aria-hidden="true"]') as HTMLElement,
    hint: () => screen.getByRole("status").textContent,
    /** The notes drawn as groups, by path, in the order they are drawn. */
    notes: () =>
      screen
        .queryAllByRole("group")
        .map((group) => group.getAttribute("aria-label"))
        .filter((name) => name?.endsWith(".md")),
  };
}
