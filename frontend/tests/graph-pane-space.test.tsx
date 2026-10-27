/**
 * Space and Enter on a focused button in the graph pane press the button.
 *
 * Space on a button starts no leader sequence, so a note button in a pattern's
 * rows table, a depth button and the Create question's buttons each take their
 * own Space and Enter. Space on the pane itself still starts one.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GraphPane } from "@/components/graph-pane";
import * as api from "@/lib/graph/graph-api";
import type { GraphCanvasHandlers } from "@/lib/graph/graph-canvas";
import { COARSE, NARROW, stubMatchMedia } from "./match-media";
import { stubCommands } from "./stub-commands";

const canvas = vi.hoisted(() => ({
  handlers: null as GraphCanvasHandlers | null,
  update: vi.fn(),
  fit: vi.fn(),
}));

vi.mock("@/lib/graph/graph-canvas", () => ({
  drawGraph: (_element: HTMLElement, handlers: GraphCanvasHandlers) => {
    canvas.handlers = handlers;
    return {
      update: canvas.update,
      resize: vi.fn(),
      fit: canvas.fit,
      cluster: vi.fn(),
      destroy: vi.fn(),
    };
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

describe("GraphPane Space on a focused button", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    canvas.handlers = null;
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

  it("A1 Space on a focused row button is not prevented and starts no leader sequence", async () => {
    vi.spyOn(api, "fetchGraph").mockResolvedValue({
      ...WHOLE,
      columns: ["?a"],
      rows: [{ "?a": "rag.md" }],
    });
    const commands = stubCommands();
    renderPane({ commands });

    const button = await screen.findByRole("button", { name: "rag" });
    const pressed = fireEvent.keyDown(button, { key: " " });
    fireEvent.keyDown(button, { key: "b" });

    expect({ pressed, toggled: commands.toggleTree.mock.calls.length }).toEqual({
      pressed: true,
      toggled: 0,
    });
  });

  it("I1 Space on the fit, depth, Create and Cancel buttons starts no leader sequence", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const ask = vi.spyOn(api, "fetchGraph").mockResolvedValue(WHOLE);
    const commands = stubCommands();
    renderPane({ commands, around: "rag.md" });
    await waitFor(() => expect(ask).toHaveBeenCalledWith(expect.objectContaining({ depth: 1 })));
    await waitFor(() => expect(canvas.handlers?.coarse()).toBe(true));

    act(() => canvas.handlers?.onOpen({ ...GHOST, degree: 1 }));
    const buttons = [
      screen.getByRole("button", { name: "fit" }),
      screen.getByRole("button", { name: "one link nearer" }),
      screen.getByRole("button", { name: "one link further" }),
      screen.getByRole("button", { name: "Create" }),
      screen.getByRole("button", { name: "Cancel" }),
    ];

    const presses: { name: string | null; pressed: boolean }[] = [];
    for (const button of buttons) {
      presses.push({ name: button.textContent, pressed: fireEvent.keyDown(button, { key: " " }) });
      fireEvent.keyDown(button, { key: "b" });
    }

    expect({ presses, toggled: commands.toggleTree.mock.calls.length }).toEqual({
      presses: buttons.map((button) => ({ name: button.textContent, pressed: true })),
      toggled: 0,
    });
  });

  it("I2 Space on the pane or from the canvas box still starts a leader sequence", async () => {
    vi.spyOn(api, "fetchGraph").mockResolvedValue(WHOLE);
    const commands = stubCommands();
    renderPane({ commands });
    await waitFor(() => expect(canvas.update).toHaveBeenCalled());

    const region = screen.getByRole("region", { name: "graph" });
    expect(fireEvent.keyDown(region, { key: " " })).toBe(false);
    fireEvent.keyDown(region, { key: "b" });
    expect(commands.toggleTree).toHaveBeenCalledOnce();

    const box = screen.getByTestId("graph-canvas");
    expect(fireEvent.keyDown(box, { key: " " })).toBe(false);
    fireEvent.keyDown(box, { key: "b" });
    expect(commands.toggleTree).toHaveBeenCalledTimes(2);
  });

  it("I5 on a touch screen a tap on a row button opens its note", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    vi.spyOn(api, "fetchGraph").mockResolvedValue({
      ...WHOLE,
      columns: ["?a"],
      rows: [{ "?a": "rag.md" }],
    });
    const { onOpen } = renderPane();

    fireEvent.click(await screen.findByRole("button", { name: "rag" }));

    expect(onOpen).toHaveBeenCalledWith("rag.md");
  });
});
