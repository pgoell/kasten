import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { SearchHit } from "@/lib/core/api";
import { useGuardedWrites } from "@/lib/saving/use-guarded-writes";
import { useRecentList } from "@/lib/search/use-recent-notes";
import type { Passage } from "@/lib/takes/highlight";

const { updateNote, searchNotes } = vi.hoisted(() => ({
  updateNote: vi.fn(),
  searchNotes: vi.fn(),
}));
vi.mock("@/lib/core/api", () => {
  class ChangedOnDisk extends Error {}
  return { updateNote, searchNotes, saveNote: vi.fn(), ChangedOnDisk };
});

const NOTE = "20 Literature/DDIA.md";
const BASE = "# DDIA\n\n## Highlights\n";

/** A passage whose text and chapter both carry markup the note must not read as markup. */
const HOSTILE: Passage = {
  text: "## Dump\n- [ ] x [[y]]",
  chapter: "- [ ] Chapter ## Dump",
};

/** The take through the real hook, with the note in the vault's listing and a notice to read. */
function setup(files: string[] = [NOTE]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["files"], files);
  const setNotice = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(
    () =>
      useGuardedWrites({
        focusedNote: { current: { path: undefined, isWriting: () => false } },
        panePath: undefined,
        setNotice,
      }),
    { wrapper },
  );
  return { take: result.current.takeHighlight, setNotice };
}

/** Lets `updateNote` apply the change the way the vault would, and keeps what it wrote. */
function writing(base: string) {
  const written: string[] = [];
  updateNote.mockImplementation(async (_path: string, change: (text: string) => string | null) => {
    const content = change(base) ?? base;
    written.push(content);
    return { path: NOTE, content };
  });
  return written;
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("a book's highlight, written", () => {
  it("writes the hostile passage inside its quote and answers the anchor id it wrote", async () => {
    const written = writing(BASE);
    const { take } = setup();

    const id = await take(NOTE, HOSTILE);

    const anchor = written[0]?.match(/\^(hl-[0-9a-f]{6})$/m)?.[1];
    expect({ id, note: written[0] }).toEqual({
      id: anchor,
      note: [
        "# DDIA",
        "",
        "## Highlights",
        "",
        "> &#35;&#35; Dump",
        ">",
        "> \\- \\[ \\] x \\[\\[y\\]\\]",
        "",
        `\\- \\[ \\] Chapter &#35;&#35; Dump ^${anchor}`,
        "",
      ].join("\n"),
    });
  });

  it("makes the Highlights heading in a note that has none", async () => {
    const written = writing("# DDIA\n");
    const { take } = setup();

    const id = await take(NOTE, { text: "A passage.", chapter: "One" });

    expect({ id, note: written[0] }).toEqual({
      id: expect.stringMatching(/^hl-[0-9a-f]{6}$/),
      note: `# DDIA\n\n## Highlights\n\n> A passage.\n\nOne ^${id}\n`,
    });
  });

  it("answers null and says why when the write failed after its read", async () => {
    updateNote.mockImplementation(
      async (_path: string, change: (text: string) => string | null) => {
        change(BASE);
        throw new Error("the save failed");
      },
    );
    const { take, setNotice } = setup();

    const id = await take(NOTE, { text: "A passage.", chapter: "One" });

    expect({ id, notice: setNotice.mock.calls.at(-1) }).toEqual({
      id: null,
      notice: ["The highlight was not written"],
    });
  });

  it("writes a passage over the page cap whole", async () => {
    const written = writing(BASE);
    const { take } = setup();
    const long = "x".repeat(2100);

    await take(NOTE, { text: long, chapter: "One" });

    expect(written[0]?.split("\n")[4]).toBe(`> ${long}`);
  });

  it("writes a tab between two table cells as a space", async () => {
    const written = writing(BASE);
    const { take } = setup();

    await take(NOTE, { text: "cell one\tcell two", chapter: "One" });

    expect(written[0]?.split("\n")[4]).toBe("> cell one cell two");
  });
});

describe("the take toast's list of recent notes", () => {
  it("keeps the notes it drew while a later reread is out (#2301)", async () => {
    const hit = { path: "01 Notes/Talk.md", line: 2, text: "modified: 2026-11-20T10:00:00+01:00" };
    searchNotes.mockResolvedValue([hit as SearchHit]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useRecentList(false), { wrapper });
    expect(result.current).toBeUndefined();
    await waitFor(() =>
      expect(result.current).toEqual([{ path: hit.path, stamp: hit.text.slice(10) }]),
    );

    searchNotes.mockReturnValue(new Promise(() => {}));
    // Not awaited: the reread never answers.
    act(() => void client.invalidateQueries());
    await waitFor(() => expect(searchNotes).toHaveBeenCalledTimes(4));
    await act(async () => {});

    expect({ asked: searchNotes.mock.calls.length, list: result.current }).toEqual({
      asked: 4,
      list: [{ path: hit.path, stamp: hit.text.slice(10) }],
    });
  });
});
