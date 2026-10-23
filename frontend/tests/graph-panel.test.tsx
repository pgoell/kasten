/**
 * The vault graph's side panel, over a canvas replaced by a recorder.
 *
 * Each test renders `GraphPane` the way the vault graph is opened. The canvas
 * is the recorder, so these tests read what the panel and the pane hand it:
 * the answer after hidden tags, the grouping it is told, and the handlers.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GraphPane } from "@/components/graph-pane";
import { tagVariable } from "@/lib/graph";
import * as api from "@/lib/graph-api";
import type { GraphCanvasHandlers } from "@/lib/graph-canvas";
import { COARSE, stubMatchMedia } from "./match-media";
import { stubCommands } from "./stub-commands";

const canvas = vi.hoisted(() => ({
  handlers: null as GraphCanvasHandlers | null,
  made: 0,
  update: vi.fn(),
  cluster: vi.fn(),
  fit: vi.fn(),
}));

vi.mock("@/lib/graph-canvas", () => ({
  drawGraph: (_element: HTMLElement, handlers: GraphCanvasHandlers) => {
    canvas.made += 1;
    canvas.handlers = handlers;
    return {
      update: canvas.update,
      resize: vi.fn(),
      fit: canvas.fit,
      cluster: canvas.cluster,
      destroy: vi.fn(),
    };
  },
}));

// Two tags on one note, one tag on another: `async` is on two notes, `Rust` on one.
const RUST = {
  path: "projects/rust.md",
  name: "rust",
  type: "Concept",
  tags: ["async", "Rust"],
  missing: false,
};
const LOG = { path: "log.md", name: "log", type: null, tags: ["async"], missing: false };
const PLAIN = { path: "plain.md", name: "plain", type: null, tags: [], missing: false };
const GHOST = { path: "Ghost.md", name: "Ghost", type: null, tags: [], missing: true };

const ANSWER = {
  nodes: [RUST, LOG, PLAIN],
  edges: [
    { source: "projects/rust.md", target: "log.md", relation: null, line: 1 },
    { source: "log.md", target: "plain.md", relation: null, line: 2 },
  ],
  columns: [],
  rows: [],
  truncated: false,
};

// What a typed filter answers with: one tagged pair, one note with another tag.
const OTHER = {
  nodes: [
    { path: "r2.md", name: "r2", type: null, tags: ["async"], missing: false },
    { path: "x.md", name: "x", type: null, tags: ["Misc"], missing: false },
  ],
  edges: [{ source: "r2.md", target: "x.md", relation: null, line: 1 }],
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

/** The canvas's last answer, as its node paths. */
function lastPaths(): string[] | undefined {
  return canvas.update.mock.lastCall?.[0].map((node: { path: string }) => node.path);
}

/** A button by its name, which the test asserts is there before it is pressed. */
function drawnButton(name: string): HTMLElement {
  const found = screen.queryByRole("button", { name });
  expect(found).not.toBeNull();
  return found as HTMLElement;
}

describe("GraphPane side panel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    canvas.made = 0;
    canvas.update.mockClear();
    canvas.cluster.mockClear();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("A8 the vault graph has a 300 px side panel with the title, the counts line and the reading line", async () => {
    vi.spyOn(api, "fetchGraph").mockResolvedValue(ANSWER);
    renderPane();
    await waitFor(() => expect(canvas.update).toHaveBeenCalled());

    const panel = screen.queryByRole("complementary", { name: "graph panel" });
    expect(panel).not.toBeNull();
    expect(panel).toHaveClass("w-[300px]", "shrink-0", "border-l", "border-k-rule");
    expect(screen.queryByText("Vault graph")).toHaveClass("font-serif");
    expect(screen.queryByText("3 notes and 2 links. The archive is left out.")).not.toBeNull();
    expect(
      screen.queryByText("Places are folders. Colour is the first tag, a ring each further tag."),
    ).not.toBeNull();
  });

  it("I2 with the archive shown the counts line says the archive is in", async () => {
    const ask = vi.spyOn(api, "fetchGraph").mockResolvedValue(ANSWER);
    renderPane({ archive: true });
    await waitFor(() => expect(canvas.update).toHaveBeenCalled());

    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ archive: true }));
    expect(screen.queryByText("3 notes and 2 links. The archive is in.")).not.toBeNull();
    expect(screen.queryByText("The archive is left out.")).toBeNull();
  });

  it("A4 the tag list shows each tag with its colour dot and count", async () => {
    vi.spyOn(api, "fetchGraph").mockResolvedValue(ANSWER);
    renderPane();
    await waitFor(() => expect(canvas.update).toHaveBeenCalled());

    const list = screen.queryByRole("list", { name: "tags" });
    expect(list).not.toBeNull();
    const rust = screen.queryByRole("button", { name: "Rust 1" });
    expect(rust).toHaveAttribute("aria-pressed", "true");
    expect(rust?.querySelector("span")?.getAttribute("style")).toContain(
      `var(${tagVariable("Rust")})`,
    );
    expect(screen.queryByRole("button", { name: "async 2" })).not.toBeNull();
  });

  it("A4 a click on a tag hides it, the count of every shown tag matches the dots the canvas is given, and a second click shows it", async () => {
    vi.spyOn(api, "fetchGraph").mockResolvedValue(ANSWER);
    renderPane();
    await waitFor(() => expect(canvas.update).toHaveBeenCalled());

    fireEvent.click(drawnButton("async 2"));

    expect(screen.queryByRole("button", { name: "async 2" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    const drawnRust = canvas.update.mock.lastCall?.[0].filter((node: { tags: string[] }) =>
      node.tags.includes("Rust"),
    );
    expect(drawnRust).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Rust 1" })).not.toBeNull();

    fireEvent.click(drawnButton("async 2"));

    expect(screen.queryByRole("button", { name: "async 2" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(canvas.update).toHaveBeenLastCalledWith(ANSWER.nodes, ANSWER.edges, undefined);
  });

  it("I4 a note whose every tag is hidden leaves the canvas with its links, and one with a shown tag left keeps it first", async () => {
    vi.spyOn(api, "fetchGraph").mockResolvedValue(ANSWER);
    renderPane();
    await waitFor(() => expect(canvas.update).toHaveBeenCalled());

    fireEvent.click(drawnButton("async 2"));

    // The log note had only `async`, so it and both its links go. Rust keeps
    // its one shown tag, which now fills its dot.
    expect(canvas.update).toHaveBeenLastCalledWith(
      [{ ...RUST, tags: ["Rust"] }, PLAIN],
      [],
      undefined,
    );
  });

  it("I4 hidden tags survive a mode switch and a new answer", async () => {
    const ask = vi
      .spyOn(api, "fetchGraph")
      .mockImplementation(async ({ query }) => (query === "" ? ANSWER : OTHER));
    renderPane();
    await waitFor(() => expect(canvas.update).toHaveBeenCalled());
    fireEvent.click(drawnButton("async 2"));

    fireEvent.click(drawnButton("Tags"));
    expect(screen.queryByRole("button", { name: "async 2" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(lastPaths()).toEqual(["projects/rust.md", "plain.md"]);

    const input = screen.getByRole("textbox", { name: "graph query" });
    fireEvent.change(input, { target: { value: "type:Concept" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(ask).toHaveBeenLastCalledWith(expect.objectContaining({ query: "type:Concept" })),
    );
    await waitFor(() => expect(lastPaths()).toEqual(["x.md"]));
    expect(screen.queryByRole("button", { name: "async 1" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("A5 the mode is stored under kasten.graph.mode and comes back on the next open", async () => {
    vi.spyOn(api, "fetchGraph").mockResolvedValue(ANSWER);
    renderPane();
    await waitFor(() => expect(canvas.update).toHaveBeenCalled());

    fireEvent.click(drawnButton("Tags"));
    expect(localStorage.getItem("kasten.graph.mode")).toBe("tags");
    cleanup();

    renderPane();
    await waitFor(() => expect(canvas.cluster).toHaveBeenLastCalledWith("tags"));
    expect(screen.queryByRole("button", { name: "Tags" })).toHaveAttribute("aria-pressed", "true");
  });

  it("A9 m switches the mode with vim on", async () => {
    localStorage.setItem("kasten.vim", "on");
    vi.spyOn(api, "fetchGraph").mockResolvedValue(ANSWER);
    renderPane();
    await waitFor(() => expect(canvas.update).toHaveBeenCalled());

    fireEvent.keyDown(screen.getByRole("region", { name: "graph" }), { key: "m" });

    expect(screen.queryByRole("button", { name: "Tags" })).toHaveAttribute("aria-pressed", "true");
  });

  it("A9 m switches the mode with vim off", async () => {
    localStorage.setItem("kasten.vim", "off");
    vi.spyOn(api, "fetchGraph").mockResolvedValue(ANSWER);
    renderPane();
    await waitFor(() => expect(canvas.update).toHaveBeenCalled());

    fireEvent.keyDown(screen.getByRole("region", { name: "graph" }), { key: "m" });

    expect(screen.queryByRole("button", { name: "Tags" })).toHaveAttribute("aria-pressed", "true");
  });

  it("I7 a mode switch calls cluster on the same canvas and makes no second drawing", async () => {
    vi.spyOn(api, "fetchGraph").mockResolvedValue(ANSWER);
    renderPane();
    await waitFor(() => expect(canvas.update).toHaveBeenCalled());
    expect(canvas.cluster).toHaveBeenLastCalledWith("folders");

    fireEvent.click(drawnButton("Tags"));

    expect(canvas.cluster).toHaveBeenLastCalledWith("tags");
    expect(canvas.made).toBe(1);
  });

  it("A8 a hovered note shows in the card, with its folder, tags and links", async () => {
    vi.spyOn(api, "fetchGraph").mockResolvedValue(ANSWER);
    renderPane();
    await waitFor(() => expect(canvas.handlers).not.toBeNull());

    act(() => canvas.handlers?.onHover?.({ node: { ...RUST, degree: 1 }, x: 10, y: 20 }));

    expect(screen.queryByText("rust")).not.toBeNull();
    expect(screen.queryByText("projects")).not.toBeNull();
    expect(screen.queryAllByText("Rust")).toHaveLength(2);
    expect(screen.queryByText("1 links in the drawing")).not.toBeNull();

    act(() => canvas.handlers?.onHover?.(null));

    expect(screen.queryByText("Hover or tap a note.")).not.toBeNull();
  });

  it("A9 on a touch screen a tap picks a written note into the card and Open opens it", async () => {
    stubMatchMedia({ [COARSE]: true });
    vi.spyOn(api, "fetchGraph").mockResolvedValue(ANSWER);
    const { onOpen } = renderPane();
    await waitFor(() => expect(canvas.handlers?.coarse()).toBe(true));

    act(() => canvas.handlers?.onOpen({ ...RUST, degree: 1 }));

    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.queryByText("projects")).not.toBeNull();

    fireEvent.click(drawnButton("Open"));

    expect(onOpen).toHaveBeenCalledWith("projects/rust.md");
  });

  it("A9 a mouse click on a note still opens it at once", async () => {
    vi.spyOn(api, "fetchGraph").mockResolvedValue(ANSWER);
    const { onOpen } = renderPane();
    await waitFor(() => expect(canvas.handlers).not.toBeNull());

    act(() => canvas.handlers?.onOpen({ ...RUST, degree: 1 }));

    expect(onOpen).toHaveBeenCalledWith("projects/rust.md");
    expect(screen.queryByText("Hover or tap a note.")).not.toBeNull();
  });

  it("I8 a tap on an unwritten note still asks before it makes it", async () => {
    stubMatchMedia({ [COARSE]: true });
    vi.spyOn(api, "fetchGraph").mockResolvedValue(ANSWER);
    const { onFollow } = renderPane();
    await waitFor(() => expect(canvas.handlers?.coarse()).toBe(true));

    act(() => canvas.handlers?.onOpen({ ...GHOST, degree: 1 }));

    expect(onFollow).not.toHaveBeenCalled();
    expect(screen.queryByText("Create Ghost?")).not.toBeNull();
  });

  it("I3 a typed filter's answer sets the counts and the tag list", async () => {
    vi.spyOn(api, "fetchGraph").mockImplementation(async ({ query }) =>
      query === "" ? ANSWER : OTHER,
    );
    renderPane();
    await waitFor(() => expect(canvas.update).toHaveBeenCalled());

    const input = screen.getByRole("textbox", { name: "graph query" });
    fireEvent.change(input, { target: { value: "type:Concept" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(screen.queryByText("2 notes and 1 links. The archive is left out.")).not.toBeNull(),
    );
    expect(screen.queryByRole("button", { name: "async 1" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Misc 1" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Rust 1" })).toBeNull();
  });

  it("I1 the graph around a note has no panel and keeps the type legend", async () => {
    vi.spyOn(api, "fetchGraph").mockResolvedValue(ANSWER);
    renderPane({ around: "projects/rust.md" });
    await waitFor(() => expect(canvas.update).toHaveBeenCalled());

    expect(screen.queryByRole("complementary", { name: "graph panel" })).toBeNull();
    expect(screen.queryByText("Concept")).not.toBeNull();
    expect(canvas.cluster).not.toHaveBeenCalled();
  });

  it("A9 in a pane under 640 px the panel sits under the canvas", async () => {
    vi.spyOn(api, "fetchGraph").mockResolvedValue(ANSWER);
    renderPane();
    await waitFor(() => expect(canvas.update).toHaveBeenCalled());

    // jsdom lays nothing out, so this asserts the container classes that do it.
    const panel = screen.queryByRole("complementary", { name: "graph panel" });
    expect(panel).not.toBeNull();
    expect(panel).toHaveClass("@max-[640px]:w-full", "@max-[640px]:max-h-[45%]");
    // The canvas sits in its column, and the column and the panel share a row
    // from 640 px only.
    expect(screen.getByTestId("graph-canvas").parentElement?.parentElement).toHaveClass(
      "flex-col",
      "@[640px]:flex-row",
    );
  });
});
