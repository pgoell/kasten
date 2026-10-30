import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { LocalGraph } from "@/components/local-graph";
import { fetchMentions, fetchSimilar } from "@/lib/api";
import type { DrawnNode } from "@/lib/graph/graph";
import { fetchGraph } from "@/lib/graph/graph-api";
import { drawGraph, type GraphCanvasHandlers } from "@/lib/graph/graph-canvas";
import { stubMatchMedia } from "./match-media";

const canvas = vi.hoisted(() => ({
  update: vi.fn(),
  resize: vi.fn(),
  fit: vi.fn(),
  view: vi.fn(),
  screenOf: vi.fn(),
  cluster: vi.fn(),
  destroy: vi.fn(),
}));
vi.mock("@/lib/graph/graph-canvas", () => ({ drawGraph: vi.fn() }));
vi.mock("@/lib/graph/graph-api", () => ({ fetchGraph: vi.fn() }));
vi.mock("@/lib/api", () => ({ fetchMentions: vi.fn(), fetchSimilar: vi.fn() }));

const NOTE = "index.md";
const node = (path: string, name: string, missing = false) => ({
  path,
  name,
  type: null,
  tags: [],
  missing,
});
const GRAPH = {
  nodes: [node(NOTE, "index"), node("other.md", "Other note"), node("borges.md", "Borges")],
  edges: [
    { source: NOTE, target: "other.md", relation: null, line: 3 },
    { source: "borges.md", target: NOTE, relation: null, line: 5 },
  ],
  columns: [],
  rows: [],
  truncated: false,
};
/** The graph around Borges, which links to index: its own nodes, so a test can tell the two apart. */
const BORGES_GRAPH = {
  nodes: [node("borges.md", "Borges"), node(NOTE, "index")],
  edges: [{ source: "borges.md", target: NOTE, relation: null, line: 5 }],
  columns: [],
  rows: [],
  truncated: false,
};
const MENTION = { path: "ref.md", line: 7, text: "Ref says", start: 0, end: 3, name: "Ref" };
/** Two notes like this one: the first has a heading, the second none; the index has read all five notes. */
const SIMILAR = {
  hits: [
    { path: "gamma.md", heading: "Ideas > Drafts", text: "Gamma says", score: 0.9 },
    { path: "delta.md", heading: "", text: "Delta says", score: 0.5 },
  ],
  read: true,
  indexed: 5,
  notes: 5,
};

/** The handlers the canvas was drawn with, from the first drawing. */
function handlers(): GraphCanvasHandlers {
  return vi.mocked(drawGraph).mock.calls[0]?.[1] as GraphCanvasHandlers;
}

function tree(path: string, onOpen = vi.fn(), onFollow = vi.fn()): ReactElement {
  // Keyed by the note, as the pane keys it, so another note starts on a fresh canvas.
  return <LocalGraph key={path} path={path} archive={false} onOpen={onOpen} onFollow={onFollow} />;
}

function renderGraph(path = NOTE, onOpen = vi.fn(), onFollow = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (element: ReactElement) => (
    <QueryClientProvider client={client}>{element}</QueryClientProvider>
  );
  const view = render(wrap(tree(path, onOpen, onFollow)));
  return {
    ...view,
    client,
    onOpen,
    onFollow,
    move: (next: string) => view.rerender(wrap(tree(next, onOpen, onFollow))),
  };
}

/** The lists are drawn once the answers arrive, so a test waits for the first redraw. */
async function drawn() {
  await waitFor(() => expect(canvas.update).toHaveBeenCalled());
}

describe("the local graph in the margin", () => {
  beforeEach(() => {
    vi.mocked(drawGraph).mockImplementation(() => canvas);
    // Each note has its own answer, so a test can see which one a drawing was given.
    vi.mocked(fetchGraph).mockImplementation((ask) =>
      Promise.resolve(ask.around === "borges.md" ? BORGES_GRAPH : GRAPH),
    );
    vi.mocked(fetchMentions).mockResolvedValue([MENTION]);
    vi.mocked(fetchSimilar).mockResolvedValue(SIMILAR);
  });

  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  it("A1 the margin graph is drawn by drawGraph in radial mode around the note", async () => {
    renderGraph();

    expect(drawGraph).toHaveBeenCalledTimes(1);
    expect(drawGraph).toHaveBeenCalledWith(expect.any(HTMLElement), expect.any(Object), {
      radial: true,
    });
    await drawn();
    expect(canvas.update).toHaveBeenLastCalledWith(GRAPH.nodes, GRAPH.edges, NOTE);
  });

  it("A2 Links, Backlinks and Unlinked mentions are listed under the graph, each with its count", async () => {
    renderGraph();
    await waitFor(() => expect(screen.getByRole("button", { name: "Other note" })).toBeTruthy());

    expect(screen.getByText(/^Links/).textContent).toBe("Links 1");
    expect(screen.getByText(/^Backlinks/).textContent).toBe("Backlinks 1");
    expect(screen.getByText(/^Unlinked mentions/).textContent).toBe("Unlinked mentions 1");
    expect(screen.getByRole("button", { name: "Borges" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "ref" })).toBeTruthy();
  });

  it("A4 a hover on a node shows its title", async () => {
    renderGraph();
    await drawn();

    act(() =>
      handlers().onHover?.({
        node: { ...node("borges.md", "Borges"), degree: 1 } as DrawnNode,
        x: 40,
        y: 50,
      }),
    );
    expect(screen.getByRole("tooltip").textContent).toBe("Borges");

    act(() => handlers().onHover?.(null));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("A4 a click on a node opens its note", async () => {
    const { onOpen } = renderGraph();
    await drawn();

    act(() => handlers().onOpen({ ...node("borges.md", "Borges"), degree: 1 } as DrawnNode));

    expect(onOpen).toHaveBeenCalledWith("borges.md");
  });

  it("A5 another note is drawn on a fresh canvas around itself", async () => {
    const { move } = renderGraph();
    await drawn();

    move("borges.md");

    // The last note's canvas is destroyed and a new one is made for the new note.
    await waitFor(() =>
      expect(canvas.update).toHaveBeenLastCalledWith(
        BORGES_GRAPH.nodes,
        BORGES_GRAPH.edges,
        "borges.md",
      ),
    );
    expect(drawGraph).toHaveBeenCalledTimes(2);
    expect(canvas.destroy).toHaveBeenCalledTimes(1);
    // The last note's drawing is never redrawn around the new one.
    expect(canvas.update).not.toHaveBeenCalledWith(GRAPH.nodes, GRAPH.edges, "borges.md");
  });

  it("B2 another note never draws the last note's answer around it", async () => {
    // The new note's answer has not arrived: nothing of the last note may stand in for it.
    vi.mocked(fetchGraph).mockImplementation((ask) =>
      ask.around === "borges.md" ? new Promise<never>(() => {}) : Promise.resolve(GRAPH),
    );
    const { move } = renderGraph();
    await drawn();

    move("borges.md");
    await act(async () => {
      await Promise.resolve();
    });

    expect(canvas.update).not.toHaveBeenCalledWith(GRAPH.nodes, GRAPH.edges, "borges.md");
    // The last note's counts are not shown, and neither is a zero standing in for them.
    expect(screen.getByText(/^Links/).textContent).toBe("Links");
    expect(screen.getByText(/^Backlinks/).textContent).toBe("Backlinks");
  });

  it("A6 the depth switch asks for two steps and back", async () => {
    renderGraph();
    await drawn();

    fireEvent.click(screen.getByRole("button", { name: "Two steps" }));
    await waitFor(() =>
      expect(fetchGraph).toHaveBeenLastCalledWith({
        query: "",
        around: NOTE,
        depth: 2,
        archive: false,
      }),
    );
    expect(screen.getByRole("button", { name: "Two steps" }).getAttribute("aria-pressed")).toBe(
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Direct" }));
    await waitFor(() =>
      expect(fetchGraph).toHaveBeenLastCalledWith({
        query: "",
        around: NOTE,
        depth: 1,
        archive: false,
      }),
    );
  });

  // jsdom has no layout, so the box's clipping and its square are read off its classes
  // here; the square itself is checked by eye in a browser.
  it("L1 the canvas box clips the drawing to its square", () => {
    renderGraph();

    const box = screen.getByTestId("local-graph-canvas");
    expect(box.className).toContain("aspect-square");
    expect(box.className).toContain("min-h-0");
    expect(box.className).toContain("overflow-hidden");
    expect(box.className).toContain("touch-pan-y");
  });

  it("L2 the lists draw no count and no empty line while their answer is on its way", async () => {
    // Neither answer lands until the test says so.
    let land: () => void = () => {};
    vi.mocked(fetchGraph).mockImplementation(
      () =>
        new Promise((resolve) => {
          land = () => resolve(GRAPH);
        }),
    );
    vi.mocked(fetchMentions).mockImplementation(() => new Promise(() => {}));
    renderGraph();

    expect(screen.getByText(/^Links/).textContent).toBe("Links");
    expect(screen.queryByText("No links.")).toBeNull();
    expect(screen.queryByText("No unlinked mentions.")).toBeNull();

    await act(async () => {
      land();
    });

    await waitFor(() => expect(screen.getByText(/^Links/).textContent).toBe("Links 1"));
  });

  it("L4 the list rows take the row press (k-row), not the button scale", async () => {
    renderGraph();
    await drawn();

    for (const name of ["Other note", "Borges", "ref"]) {
      expect(screen.getByRole("button", { name }).classList.contains("k-row")).toBe(true);
    }
  });

  // jsdom has no layout, so the ellipsis is the `truncate` class's, read off the name's span.
  it("B4 a long name in the lists ends in an ellipsis", async () => {
    renderGraph();
    await drawn();

    const name = screen.getByRole("button", { name: "Other note" }).querySelector("span");
    expect(name).not.toBeNull();
    expect(name?.textContent).toBe("Other note");
    expect(name?.className).toContain("min-w-0");
    expect(name?.className).toContain("truncate");
  });

  it("L5 under a finger the depth buttons, the rows and the Graph button are 44 px targets", async () => {
    renderGraph();
    await drawn();

    for (const button of screen.getAllByRole("button", { name: /Direct|Two steps/ })) {
      expect(button.className).toContain("pointer-coarse:min-h-11");
    }
    const row = screen.getByRole("button", { name: "Other note" });
    expect(row.className).toContain("pointer-coarse:min-h-11");
    expect(row.className).toContain("flex items-center");
  });

  it("I3 a failed graph and mentions read leave the plain lines", async () => {
    vi.mocked(fetchGraph).mockRejectedValue(new Error("The graph is down"));
    vi.mocked(fetchMentions).mockRejectedValue(new Error("The search is down"));
    renderGraph();
    await waitFor(() => expect(fetchMentions).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });

    // The failed reads settle into the plain lines, once they are no longer pending.
    await waitFor(() => expect(screen.getByText("No links.")).toBeTruthy());
    expect(screen.getByText("No backlinks.")).toBeTruthy();
    expect(screen.getByText("No unlinked mentions.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(canvas.update).not.toHaveBeenCalled();
  });

  it("I4 a click on an unwritten note follows its link, and a tap asks first", async () => {
    const ghost = { ...node("ghost.md", "ghost", true), degree: 1 } as DrawnNode;

    // A mouse follows at once.
    const mouse = renderGraph();
    await drawn();
    act(() => handlers().onOpen(ghost));
    expect(mouse.onFollow).toHaveBeenCalledWith("ghost");
    cleanup();

    // A finger is asked first, and Create is what follows.
    vi.mocked(drawGraph).mockClear();
    stubMatchMedia({ "(pointer: coarse)": true });
    const finger = renderGraph();
    await drawn();
    act(() => handlers().onOpen(ghost));
    expect(finger.onFollow).not.toHaveBeenCalled();
    expect(screen.getByText("Create ghost?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(finger.onFollow).toHaveBeenCalledWith("ghost");
  });

  it("I5 a new answer after a save updates the same canvas", async () => {
    const { client } = renderGraph();
    await drawn();

    const grown = {
      ...GRAPH,
      nodes: [...GRAPH.nodes, node("ref.md", "Ref")],
      edges: [...GRAPH.edges, { source: "ref.md", target: NOTE, relation: null, line: 2 }],
    };
    vi.mocked(fetchGraph).mockResolvedValue(grown);
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["graph"] });
    });

    await waitFor(() =>
      expect(canvas.update).toHaveBeenLastCalledWith(grown.nodes, grown.edges, NOTE),
    );
    expect(drawGraph).toHaveBeenCalledTimes(1);
  });
  it("S1 the notes like this one are listed with their count and heading", async () => {
    renderGraph();
    await waitFor(() => expect(screen.getByRole("button", { name: /gamma/ })).toBeTruthy());

    expect(screen.getByText(/^Notes like this one/).textContent).toBe("Notes like this one 2");
    expect(screen.getByText("Ideas > Drafts").className).toContain("text-k-muted");
    expect(screen.getByRole("button", { name: "delta" })).toBeTruthy();
  });

  it("S2 a click on a note like this one opens its note", async () => {
    const { onOpen } = renderGraph();
    await waitFor(() => expect(screen.getByRole("button", { name: /gamma/ })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /gamma/ }));

    expect(onOpen).toHaveBeenCalledWith("gamma.md");
  });

  it("S3 moving to another note shows that note's list, not the last one's", async () => {
    vi.mocked(fetchSimilar).mockImplementation(async (path) =>
      path === "borges.md"
        ? { ...SIMILAR, hits: [{ path: "kafka.md", heading: "", text: "Kafka", score: 0.8 }] }
        : SIMILAR,
    );
    const { move } = renderGraph();
    await waitFor(() => expect(screen.getByRole("button", { name: /gamma/ })).toBeTruthy());

    move("borges.md");

    await waitFor(() => expect(screen.getByRole("button", { name: "kafka" })).toBeTruthy());
    expect(screen.queryByRole("button", { name: /gamma/ })).toBeNull();
    expect(fetchSimilar).toHaveBeenLastCalledWith("borges.md", false);
  });

  it("S4 a note the index has not read yet says so", async () => {
    vi.mocked(fetchSimilar).mockResolvedValue({ hits: [], read: false, indexed: 5, notes: 5 });
    renderGraph();

    await waitFor(() => expect(screen.getByText("Not in the index yet.")).toBeTruthy());
    expect(screen.getByText(/^Notes like this one/).textContent).toBe("Notes like this one 0");
  });

  it("S5 no notes like this one, with the index whole, says so", async () => {
    vi.mocked(fetchSimilar).mockResolvedValue({ hits: [], read: true, indexed: 5, notes: 5 });
    renderGraph();

    await waitFor(() => expect(screen.getByText("No notes like this one.")).toBeTruthy());
    expect(screen.queryByText(/^Index filling/)).toBeNull();
  });

  it("S6 no notes like this one while the index fills says so, and how far it has got", async () => {
    vi.mocked(fetchSimilar).mockResolvedValue({ hits: [], read: true, indexed: 2, notes: 5 });
    renderGraph();

    await waitFor(() => expect(screen.getByText("No notes like this one yet.")).toBeTruthy());
    expect(screen.getByText("Index filling: 2 of 5 notes.")).toBeTruthy();
  });

  it("S7 a failed read of the notes like this one shows the plain line", async () => {
    vi.mocked(fetchSimilar).mockRejectedValue(new Error("The index is down"));
    renderGraph();

    await waitFor(() => expect(screen.getByText("No notes like this one.")).toBeTruthy());
    expect(screen.getByText(/^Notes like this one/).textContent).toBe("Notes like this one 0");
  });

  it("S8 the notes like this one draw no count while their answer is on its way", async () => {
    vi.mocked(fetchSimilar).mockImplementation(() => new Promise(() => {}));
    renderGraph();

    expect(screen.getByText(/^Notes like this one/).textContent).toBe("Notes like this one");
    expect(screen.queryByText("No notes like this one.")).toBeNull();
  });
});
