import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { NotePane } from "@/components/note-pane";
import type { Pane } from "@/lib/panes";
import { stubCommands } from "./stub-commands";

const { fetchNote, fetchMentions } = vi.hoisted(() => ({
  fetchNote: vi.fn(),
  fetchMentions: vi.fn(),
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  fetchNote,
  fetchMentions,
}));
vi.mock("@/lib/graph/graph-api", () => ({
  fetchGraph: vi.fn().mockResolvedValue({
    nodes: [],
    edges: [],
    columns: [],
    rows: [],
    truncated: false,
  }),
}));
vi.mock("@/lib/graph/graph-canvas", () => ({
  drawGraph: () => ({ update() {}, resize() {}, fit() {}, destroy() {} }),
}));

type Props = ComponentProps<typeof NotePane>;

/** The props a note pane takes, with nothing to say about the vault beyond the one note. */
function props(path: string, graphSignal: number): Props {
  return {
    shown: { id: path, path } as Pane,
    focused: false,
    focusSignal: 0,
    commands: stubCommands(),
    preview: true,
    archive: false,
    listings: { data: [], linkable: [], images: [], tags: [], relations: [] },
    opening: {
      follow: () => {},
      embeds: undefined,
      openPassage: () => {},
      openInPane: () => {},
    },
    mark: undefined,
    buffer: {
      held: [],
      standbyReload: () => () => false,
      typed: () => {},
      reload: () => Promise.resolve(null),
    },
    allowReload: () => false,
    onSave: () => {},
    onCycleTodo: () => {},
    onNotice: () => {},
    graphSignal,
    onGraphPane: () => {},
  } as unknown as Props;
}

describe("the graph signal across two panes", () => {
  beforeEach(() => {
    fetchNote.mockResolvedValue("# Note\n\nText.\n");
    fetchMentions.mockResolvedValue([]);
  });

  afterEach(() => cleanup());

  it("B1 Space gl in one pane opens no graph in the pane asked before it", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrap = (a: Props, b: Props) => (
      <QueryClientProvider client={client}>
        <NotePane {...a} />
        <NotePane {...b} />
      </QueryClientProvider>
    );
    // Both panes were asked once already, so the mount sees the count and opens nothing.
    const view = render(wrap(props("a.md", 1), props("b.md", 1)));
    expect(screen.queryAllByRole("dialog")).toHaveLength(0);

    // Space gl is pressed in pane B: its count moves, and pane A's count drops to 0.
    view.rerender(wrap(props("a.md", 0), props("b.md", 2)));

    // Only B's sheet opens. A's would be a second dialog.
    expect(screen.queryAllByRole("dialog", { name: "Local graph" })).toHaveLength(1);
  });
});
