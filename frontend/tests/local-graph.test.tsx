import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { LocalGraph } from "@/components/local-graph";
import { fetchMentions } from "@/lib/api";
import type { DrawnNode } from "@/lib/graph";
import { fetchGraph } from "@/lib/graph-api";
import { drawGraph, type GraphCanvasHandlers } from "@/lib/graph-canvas";
import { stubMatchMedia } from "./match-media";

const canvas = vi.hoisted(() => ({
  update: vi.fn(),
  resize: vi.fn(),
  fit: vi.fn(),
  destroy: vi.fn(),
}));
vi.mock("@/lib/graph-canvas", () => ({ drawGraph: vi.fn() }));
vi.mock("@/lib/graph-api", () => ({ fetchGraph: vi.fn() }));
vi.mock("@/lib/api", () => ({ fetchMentions: vi.fn() }));

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
const MENTION = { path: "ref.md", line: 7, text: "Ref says", start: 0, end: 3, name: "Ref" };

/** The handlers the canvas was drawn with, from the first drawing. */
function handlers(): GraphCanvasHandlers {
  return vi.mocked(drawGraph).mock.calls[0]?.[1] as GraphCanvasHandlers;
}

function tree(path: string, onOpen = vi.fn(), onFollow = vi.fn()): ReactElement {
  return <LocalGraph path={path} archive={false} onOpen={onOpen} onFollow={onFollow} />;
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
    vi.mocked(fetchGraph).mockResolvedValue(GRAPH);
    vi.mocked(fetchMentions).mockResolvedValue([MENTION]);
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

  it("A5 another note redraws the same canvas around it", async () => {
    const { move } = renderGraph();
    await drawn();

    move("borges.md");

    await waitFor(() =>
      expect(canvas.update).toHaveBeenLastCalledWith(GRAPH.nodes, GRAPH.edges, "borges.md"),
    );
    expect(drawGraph).toHaveBeenCalledTimes(1);
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

  it("I3 a failed graph and mentions read leave the plain lines", async () => {
    vi.mocked(fetchGraph).mockRejectedValue(new Error("The graph is down"));
    vi.mocked(fetchMentions).mockRejectedValue(new Error("The search is down"));
    renderGraph();
    await waitFor(() => expect(fetchMentions).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("No links.")).toBeTruthy();
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
});
