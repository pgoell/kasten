/**
 * The vault graph's frame tests share this rig: three answers (the dev vault's as
 * `/api/graph` gave it, a tag-rich synthetic vault and a 2000-note one), a mount of
 * `GraphPane` in a box, and the wait for a drawing to stop moving.
 *
 * `fetchGraph` is mocked in each test file, since vitest hoists `vi.mock` there, and
 * `serveGraph` gives it the answer a test draws. The timing test reads the answers
 * and the still-frame probe only, so nothing here may need a module that is new on
 * this branch at import time.
 */

// The three faces `main.tsx` loads, so the pictures show the app's type.
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/instrument-sans/index.css";
import "@fontsource-variable/jetbrains-mono/index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { waitFor } from "@testing-library/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { commands, page } from "vitest/browser";
import { GraphPane } from "@/components/graph-pane";
import type { GraphEdge, GraphNode } from "@/lib/graph/graph";
import { fetchGraph, type Graph } from "@/lib/graph/graph-api";
import { COARSE, NARROW, stubMatchMedia } from "../match-media";
import { stubCommands } from "../stub-commands";
import { need, PATIENCE, type Size, type Theme } from "./reader-fixture";
import dev from "./vault-graph-dev.json";
import "@/styles/app.css";

export type Mode = "folders" | "tags";
const MODE_KEY = "kasten.graph.mode";
const VIM_KEY = "kasten.vim";

/** The answer `/api/graph` gave for the dev vault: 75 notes, 67 links, 3 tagged notes. */
export const DEV_ANSWER: Graph = dev;

/** mulberry32: the same seed draws the same vault on every run and machine. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAGS = ["design", "reading", "tokens", "project", "people", "ideas", "log", "travel"];

interface Plan {
  folders: string[];
  notes: number;
  links: number;
  /** Unwritten notes, at the vault root, that links name and nobody wrote. */
  ghosts: number;
  seed: number;
}

/** 0 to 3 tags, the first leaning on the folder `f`. */
function tagsOf(f: number, below: (n: number) => number): string[] {
  const tags: string[] = [];
  const count = [0, 1, 1, 2, 2, 2, 3][below(7)] ?? 0;
  for (let t = 0; t < count; t++) {
    const tag = t === 0 ? TAGS[(f * 2 + below(3)) % TAGS.length] : TAGS[below(TAGS.length)];
    if (tag !== undefined && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

/** Where a link's target is drawn from: 5% unwritten notes, most its own folder, the rest anywhere. */
function poolOf(roll: number, unwritten: string[], folder: string[], written: string[]): string[] {
  if (unwritten.length > 0 && roll < 0.05) return unwritten;
  return roll < 0.85 ? folder : written;
}

/**
 * A vault from a plan. Notes are spread over the folders, with 0 to 3 tags each,
 * and the first tag leans on the folder so a folder's notes share a tag area. Most
 * links stay inside a folder; a few reach a note in another one or an unwritten note.
 */
function generate({ folders, notes, links, ghosts, seed }: Plan): Graph {
  const rnd = seeded(seed);
  const below = (n: number) => Math.floor(rnd() * n);
  const nodes: GraphNode[] = [];
  const members: string[][] = folders.map(() => []);
  const folderOf = new Map<string, number>();

  for (let i = 0; i < notes; i++) {
    const f = i % folders.length;
    const path = `${folders[f] ?? ""}/Note ${i}.md`;
    const tags = tagsOf(f, below);
    nodes.push({ path, name: `Note ${i}`, type: "Concept", tags, missing: false });
    members[f]?.push(path);
    folderOf.set(path, f);
  }
  const written = [...folderOf.keys()];
  const unwritten = Array.from({ length: ghosts }, (_, g) => `Ghost ${g}.md`);
  for (const path of unwritten) {
    nodes.push({ path, name: path.replace(/\.md$/, ""), type: null, tags: [], missing: true });
  }

  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  while (edges.length < links) {
    const source = written[below(written.length)] ?? "";
    const f = folderOf.get(source) ?? 0;
    const pool = poolOf(rnd(), unwritten, members[f] ?? [], written);
    const target = pool[below(pool.length || 1)];
    const key = `${source}>${target}`;
    if (target === undefined || target === source || seen.has(key)) continue;
    seen.add(key);
    edges.push({ source, target, relation: null, line: 1 });
  }
  return { nodes, edges, columns: [], rows: [], truncated: false };
}

/** 120 notes in six folders, two of them under `02 Projects`, with 8 tags and 6 unwritten notes. */
export const SYNTHETIC: Graph = generate({
  folders: [
    "01 Areas",
    "02 Projects/A",
    "02 Projects/B",
    "03 Resources",
    "04 Reading",
    "05 Journal",
  ],
  notes: 120,
  links: 300,
  ghosts: 6,
  seed: 782,
});

/** 2000 notes in twenty folders, four of them project folders under `20 Projects`, with about 3000 links. */
export const LARGE: Graph = generate({
  folders: Array.from({ length: 20 }, (_, f) =>
    f < 16 ? `Area ${f}` : `20 Projects/Project ${f}`,
  ),
  notes: 2000,
  links: 3000,
  ghosts: 0,
  seed: 2000,
});

/** The answer every mount draws, set by a test before it mounts. */
export function serveGraph(answer: Graph): void {
  vi.mocked(fetchGraph).mockImplementation(async () => answer);
}

/** Elements this test put in the page, removed after it. */
const placed: HTMLElement[] = [];
/** Roots this test mounted, unmounted after it. */
const mounted: Array<{ root: Root; host: HTMLElement }> = [];

/** A box of the size given, in the body or in `parent`, which the pane fills. */
export function boxOf(width: number, height: number, parent?: HTMLElement): HTMLDivElement {
  const element = document.createElement("div");
  element.style.width = `${width}px`;
  element.style.height = `${height}px`;
  element.style.flex = "none";
  if (parent) parent.appendChild(element);
  else {
    document.body.appendChild(element);
    placed.push(element);
  }
  return element;
}

/** A row of boxes side by side, for a split. */
export function rowOf(width: number, height: number): HTMLDivElement {
  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.width = `${width}px`;
  row.style.height = `${height}px`;
  document.body.appendChild(row);
  placed.push(row);
  return row;
}

/**
 * The page as a size, a theme, a grouping and vim asks for it. The media stub
 * answers width and pointer as the app reads them, and touch is emulated for the browser's own CSS.
 */
export async function setUp(
  size: Size,
  theme: Theme,
  mode: Mode = "folders",
  vim: "on" | "off" = "on",
): Promise<void> {
  await page.viewport(size.width, size.height);
  await commands.emulateMedia({
    touch: size.coarse,
    reducedMotion: "no-preference",
    contrast: "no-preference",
    reducedTransparency: "no-preference",
  });
  stubMatchMedia({ [NARROW]: size.width < 768, [COARSE]: size.coarse });
  localStorage.clear();
  localStorage.setItem(VIM_KEY, vim);
  localStorage.setItem(MODE_KEY, mode);
  document.documentElement.dataset.theme = theme;
}

/** Mounts the vault graph in `host`, and gives back the spies its handlers call. */
export async function mountPane(host: HTMLElement) {
  const onOpen = vi.fn();
  const onFollow = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(host);
  mounted.push({ root, host });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <GraphPane commands={stubCommands()} onOpen={onOpen} onFollow={onFollow} />
      </QueryClientProvider>,
    );
  });
  return { onOpen, onFollow };
}

/** Unmounts the pane in `host` now, for a test that draws several in turn. */
export async function unmountPane(host: HTMLElement): Promise<void> {
  const entry = mounted.find((one) => one.host === host);
  if (entry) mounted.splice(mounted.indexOf(entry), 1);
  await act(async () => entry?.root.unmount());
  host.remove();
}

/** The canvas the graph draws on, once it is there. */
export async function untilCanvas(host: HTMLElement): Promise<HTMLCanvasElement> {
  await waitFor(
    () => expect(host.querySelector("[data-testid='graph-canvas'] canvas")).not.toBeNull(),
    PATIENCE,
  );
  return need(
    host.querySelector<HTMLCanvasElement>("[data-testid='graph-canvas'] canvas"),
    "canvas",
  );
}

/** Two animation frames: the first lays out the last change, the second paints it. */
export const frame = () => new Promise<void>((done) => requestAnimationFrame(() => done()));

const probe = document.createElement("canvas");
probe.width = 96;
probe.height = 64;
const probeContext = need(
  probe.getContext("2d", { willReadFrequently: true }),
  "2d context for the still probe",
);

/**
 * A hash of the canvas, read through a 96 by 64 copy: the same from frame to frame
 * once the drawing has stopped moving, and a different one when a note has moved.
 */
export function signatureOf(source: HTMLCanvasElement): number {
  probeContext.clearRect(0, 0, 96, 64);
  probeContext.drawImage(source, 0, 0, 96, 64);
  const data = probeContext.getImageData(0, 0, 96, 64).data;
  let hash = 0;
  for (const value of data) hash = (hash * 31 + value) | 0;
  return hash;
}

/** Waits until the drawing has held still for `frames` frames, or for 900 frames at most. */
export async function untilStill(host: HTMLElement, frames = 15): Promise<void> {
  const canvas = await untilCanvas(host);
  let last = Number.NaN;
  let still = 0;
  for (let i = 0; i < 900 && still < frames; i++) {
    await frame();
    const now = signatureOf(canvas);
    still = now === last ? still + 1 : 0;
    last = now;
  }
}

/** Waits for the vault graph's panel to hold its counts, which a finished answer draws. */
export async function untilCounted(host: HTMLElement): Promise<void> {
  await waitFor(
    () => expect(host.querySelector("aside")?.textContent).toContain("notes and"),
    PATIENCE,
  );
}

/**
 * Waits until the canvas is as wide as its box. force-graph draws its canvas at the
 * window's width first and takes the box's width only when the pane's ResizeObserver
 * calls back, so a check right after the counts can catch the canvas too wide.
 */
export async function untilSized(host: HTMLElement): Promise<void> {
  const canvas = await untilCanvas(host);
  const box = need(
    host.querySelector<HTMLElement>("[data-testid='graph-canvas']"),
    "graph canvas box",
  );
  await waitFor(() => {
    const boxWidth = box.getBoundingClientRect().width;
    expect(boxWidth).toBeGreaterThan(0);
    expect(Math.abs(canvas.getBoundingClientRect().width - boxWidth)).toBeLessThan(1);
  }, PATIENCE);
}

/** The put-back every vault graph test shares. A test that mounts serves its own answer. */
export function registerVaultFixture() {
  afterEach(async () => {
    for (const { root, host } of mounted.splice(0)) {
      await act(async () => root.unmount());
      host.remove();
    }
    for (const element of placed.splice(0)) element.remove();
    vi.unstubAllGlobals();
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-palette");
    await commands.emulateMedia({});
    await page.viewport(1280, 900);
  });
}
