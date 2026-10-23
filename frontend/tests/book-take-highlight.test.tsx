import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Passage } from "@/lib/highlight";
import { useGuardedWrites } from "@/lib/use-guarded-writes";

const { updateNote } = vi.hoisted(() => ({ updateNote: vi.fn() }));
vi.mock("@/lib/api", () => {
  class ChangedOnDisk extends Error {}
  return { updateNote, saveNote: vi.fn(), ChangedOnDisk };
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
});
