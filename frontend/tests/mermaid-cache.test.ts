/**
 * The drawings kept are bounded (#838). The package is mocked as in
 * `mermaid-theme.test.ts`, and each case gets a module of its own.
 */

const { render, pause } = vi.hoisted(() => {
  const pause: { source?: string; gate?: Promise<void> } = {};
  const render = vi.fn(async (_id: string, source: string) => {
    if (source === pause.source) await pause.gate;
    return { svg: `<svg aria-label="${source}"></svg>` };
  });
  return { render, pause };
});
vi.mock("@/lib/theme", () => ({ currentTheme: () => "light" }));
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render,
  },
}));

beforeEach(() => {
  vi.resetModules();
  render.mockClear();
  pause.source = undefined;
  pause.gate = undefined;
});

/** How many times mermaid was asked to draw `source`. */
function rendersOf(source: string): number {
  return render.mock.calls.filter(([, drawn]) => drawn === source).length;
}

const s = (i: number) => `graph TD; s${i}-->t`;

describe("mermaid's cache", () => {
  it("#838 A1 past 32 drawings the oldest is drawn again and a recent one is not", async () => {
    const { drawMermaid, drawnMermaid } = await import("@/lib/mermaid");
    // 32 is RECENT in mermaid.ts: the drawings kept besides those on screen.
    for (let i = 0; i <= 32; i++) await drawMermaid(s(i));

    const oldest = drawnMermaid(s(0));
    const recent = drawnMermaid(s(1));
    await drawMermaid(s(0));

    expect({ oldest, recent: recent !== undefined, redrawn: rendersOf(s(0)) }).toEqual({
      oldest: undefined,
      recent: true,
      redrawn: 2,
    });
  });

  it("#838 I3 a running draw asked twice renders once", async () => {
    const { drawMermaid } = await import("@/lib/mermaid");
    const first = drawMermaid(s(0));
    const second = drawMermaid(s(0));
    await Promise.all([first, second]);

    expect(rendersOf(s(0))).toBe(1);
  });

  it("#838 I3 a draw evicted while it runs does not come back when it lands", async () => {
    const { drawMermaid, drawnMermaid } = await import("@/lib/mermaid");
    // The first draw waits for `release`; the inTurn chain holds the others behind it.
    let release = (): void => {};
    pause.source = s(0);
    pause.gate = new Promise<void>((done) => {
      release = done;
    });
    const draws: Promise<unknown>[] = [];
    for (let i = 0; i <= 33; i++) draws.push(drawMermaid(s(i)));
    release();
    await Promise.all(draws);

    const landed = Array.from({ length: 34 }, (_, i) => drawnMermaid(s(i))).filter(
      (drawing) => drawing !== undefined,
    );
    expect({ running: drawnMermaid(s(0)), kept: landed.length }).toEqual({
      running: undefined,
      kept: 32,
    });
  });
});
