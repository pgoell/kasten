/**
 * The graph pane over a canvas replaced by a recorder.
 *
 * jsdom has no canvas, and what the pane owes is not the drawing: it is the
 * question it asks, the answer it hands the canvas, the error it shows and the
 * rows a pattern answers with. `graph.test.ts` covers the drawing's arithmetic.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GraphPane } from "@/components/graph-pane";
import * as api from "@/lib/api";
import type { GraphCanvasHandlers } from "@/lib/graph-canvas";
import { COARSE, NARROW, stubMatchMedia } from "./match-media";
import { stubCommands } from "./stub-commands";

const canvas = vi.hoisted(() => ({
  handlers: null as GraphCanvasHandlers | null,
  update: vi.fn(),
  fit: vi.fn(),
}));

vi.mock("@/lib/graph-canvas", () => ({
  drawGraph: (_element: HTMLElement, handlers: GraphCanvasHandlers) => {
    canvas.handlers = handlers;
    return { update: canvas.update, resize: vi.fn(), fit: canvas.fit, destroy: vi.fn() };
  },
}));

const RAG = { path: "rag.md", name: "rag", type: "Concept", tags: [], missing: false };
const GHOST = { path: "Ghost.md", name: "Ghost", type: null, tags: [], missing: true };

const WHOLE = {
  nodes: [RAG, GHOST],
  edges: [{ source: "rag.md", target: "Ghost.md", relation: null, line: 3 }],
  columns: [],
  rows: [],
  truncated: false,
};

function renderPane(props: Partial<Parameters<typeof GraphPane>[0]> = {}) {
  const onOpen = vi.fn();
  const onFollow = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <GraphPane commands={stubCommands()} onOpen={onOpen} onFollow={onFollow} {...props} />
    </QueryClientProvider>,
  );
  return { onOpen, onFollow };
}

describe("GraphPane", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    canvas.update.mockClear();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("draws the whole vault when nothing is typed", async () => {
    const ask = vi.spyOn(api, "fetchGraph").mockResolvedValue(WHOLE);
    renderPane();

    await waitFor(() =>
      expect(canvas.update).toHaveBeenCalledWith(WHOLE.nodes, WHOLE.edges, undefined),
    );
    expect(ask).toHaveBeenCalledWith({
      query: "",
      around: undefined,
      depth: undefined,
      archive: false,
    });
    expect(screen.getByText("2 notes, 1 links")).toBeInTheDocument();
  });

  it("asks what was typed once Enter is pressed", async () => {
    const ask = vi.spyOn(api, "fetchGraph").mockResolvedValue(WHOLE);
    renderPane();
    const input = screen.getByRole("textbox", { name: "graph query" });

    fireEvent.change(input, { target: { value: "type:Concept" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(ask).toHaveBeenLastCalledWith(expect.objectContaining({ query: "type:Concept" })),
    );
  });

  it("shows the backend's sentence when the query cannot be read", async () => {
    vi.spyOn(api, "fetchGraph").mockRejectedValue(new Error("No filter is called colour:"));
    renderPane();

    expect(await screen.findByRole("alert")).toHaveTextContent("No filter is called colour:");
  });

  it("draws a pattern's rows and opens the note a row names", async () => {
    vi.spyOn(api, "fetchGraph").mockResolvedValue({
      ...WHOLE,
      columns: ["?a", "?how"],
      rows: [{ "?a": "rag.md", "?how": "depends-on" }],
    });
    const { onOpen } = renderPane();

    fireEvent.click(await screen.findByRole("button", { name: "rag" }));

    expect(onOpen).toHaveBeenCalledWith("rag.md");
    expect(screen.getByText("depends-on")).toBeInTheDocument();
    expect(screen.getByText("1 row")).toBeInTheDocument();
  });

  it("opens a note clicked on the canvas, and follows a link to one nobody wrote", async () => {
    vi.spyOn(api, "fetchGraph").mockResolvedValue(WHOLE);
    const { onOpen, onFollow } = renderPane();
    await waitFor(() => expect(canvas.handlers).not.toBeNull());

    act(() => canvas.handlers?.onOpen({ ...RAG, degree: 1 }));
    act(() => canvas.handlers?.onOpen({ ...GHOST, degree: 1 }));

    expect(onOpen).toHaveBeenCalledWith("rag.md");
    expect(onFollow).toHaveBeenCalledWith("Ghost");
  });

  it("asks before a tap makes a note nobody wrote, and makes it on Create", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    vi.spyOn(api, "fetchGraph").mockResolvedValue(WHOLE);
    const { onOpen, onFollow } = renderPane();
    await waitFor(() => expect(canvas.handlers?.coarse()).toBe(true));

    act(() => canvas.handlers?.onOpen({ ...GHOST, degree: 1 }));

    expect(onFollow).not.toHaveBeenCalled();
    expect(screen.getByText("Create Ghost?")).toBeInTheDocument();
    const create = screen.getByRole("button", { name: "Create" });
    expect(create).toHaveClass("min-h-11");

    fireEvent.click(create);

    expect(onFollow).toHaveBeenCalledWith("Ghost");
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.queryByText("Create Ghost?")).toBeNull();
  });

  it("drops the question on Cancel, a tap elsewhere or another query", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    vi.spyOn(api, "fetchGraph").mockResolvedValue(WHOLE);
    const { onOpen, onFollow } = renderPane();
    await waitFor(() => expect(canvas.handlers?.coarse()).toBe(true));
    const tapGhost = () => act(() => canvas.handlers?.onOpen({ ...GHOST, degree: 1 }));

    tapGhost();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Create Ghost?")).toBeNull();

    tapGhost();
    act(() => canvas.handlers?.onBlank());
    expect(screen.queryByText("Create Ghost?")).toBeNull();

    tapGhost();
    fireEvent.change(screen.getByRole("textbox", { name: "graph query" }), {
      target: { value: "type:Concept" },
    });
    expect(screen.queryByText("Create Ghost?")).toBeNull();

    // A note that is there opens at once, question or no question.
    tapGhost();
    act(() => canvas.handlers?.onOpen({ ...RAG, degree: 1 }));
    expect(onOpen).toHaveBeenCalledWith("rag.md");
    expect(screen.queryByText("Create Ghost?")).toBeNull();
    expect(onFollow).not.toHaveBeenCalled();
  });

  it("tells the canvas a finger is pointing on a touch screen, and not on a desktop", async () => {
    vi.spyOn(api, "fetchGraph").mockResolvedValue(WHOLE);
    renderPane();
    await waitFor(() => expect(canvas.update).toHaveBeenCalled());
    expect(canvas.handlers?.coarse()).toBe(false);
    cleanup();

    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    renderPane();
    await waitFor(() => expect(canvas.handlers?.coarse()).toBe(true));
    expect(screen.getByTestId("graph-canvas")).toHaveClass("touch-none");
  });

  it("reaches further out around a note with +", async () => {
    const ask = vi.spyOn(api, "fetchGraph").mockResolvedValue(WHOLE);
    renderPane({ around: "rag.md" });
    await waitFor(() => expect(ask).toHaveBeenCalledWith(expect.objectContaining({ depth: 1 })));

    fireEvent.keyDown(screen.getByRole("region", { name: "graph" }), { key: "+" });

    await waitFor(() =>
      expect(ask).toHaveBeenLastCalledWith(expect.objectContaining({ around: "rag.md", depth: 2 })),
    );
  });

  it("fits and reaches by tap, where a finger has no f, + or -", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const ask = vi.spyOn(api, "fetchGraph").mockResolvedValue(WHOLE);
    renderPane({ around: "rag.md" });
    await waitFor(() => expect(ask).toHaveBeenCalledWith(expect.objectContaining({ depth: 1 })));

    canvas.fit.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "fit" }));
    expect(canvas.fit).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "one link further" }));
    await waitFor(() =>
      expect(ask).toHaveBeenLastCalledWith(expect.objectContaining({ depth: 2 })),
    );
    fireEvent.click(screen.getByRole("button", { name: "one link nearer" }));
    await waitFor(() =>
      expect(ask).toHaveBeenLastCalledWith(expect.objectContaining({ depth: 1 })),
    );
  });

  it("offers no depth on the whole vault, and no row at all under a mouse", async () => {
    const media = stubMatchMedia({ [COARSE]: true });
    vi.spyOn(api, "fetchGraph").mockResolvedValue(WHOLE);
    renderPane();

    expect(screen.getByRole("button", { name: "fit" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "one link further" })).toBeNull();

    media.set(COARSE, false);
    expect(screen.queryByRole("button", { name: "fit" })).toBeNull();
  });
});
