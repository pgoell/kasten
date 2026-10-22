/**
 * The theme mermaid is initialised with for each draw, read when the draw starts
 * (#835).
 *
 * The package is mocked as in `mermaid-load.test.tsx`. Each case gets a module
 * of its own, since the load is kept for the life of the module and would hand
 * the first case's theme to the second.
 */

const { initialize, theme } = vi.hoisted(() => ({
  initialize: vi.fn(),
  theme: { current: "light" as "light" | "dark" },
}));
vi.mock("@/lib/theme", () => ({ currentTheme: () => theme.current }));
vi.mock("mermaid", () => ({
  default: {
    initialize,
    // Each svg names the theme mermaid was last initialised with. It reads that
    // after a tick, so a draw that starts before the previous render ends would
    // name the other draw's theme.
    render: async () => {
      await new Promise((done) => setTimeout(done, 0));
      return { svg: `<svg data-theme="${initialize.mock.lastCall?.[0]?.theme}"></svg>` };
    },
  },
}));

beforeEach(() => {
  vi.resetModules();
  initialize.mockClear();
});

/** Draws one diagram in `current` and answers what mermaid was initialised with. */
async function initialisedIn(current: "light" | "dark") {
  theme.current = current;
  const { drawMermaid } = await import("@/lib/mermaid");
  await drawMermaid("graph TD; a-->b");
  return initialize.mock.calls[0]?.[0];
}

describe("mermaid's theme", () => {
  it("takes mermaid's default theme in light", async () => {
    expect(await initialisedIn("light")).toMatchObject({ theme: "default" });
  });

  it("takes mermaid's dark theme in dark", async () => {
    expect(await initialisedIn("dark")).toMatchObject({ theme: "dark" });
  });

  it("#835 A3 a switch back shows the drawing of that theme, not the other", async () => {
    const { drawMermaid, drawnMermaid } = await import("@/lib/mermaid");
    const source = "graph TD; a-->b";
    await drawMermaid(source, "light");
    await drawMermaid(source, "dark");

    expect({
      light: drawnMermaid(source, "light"),
      dark: drawnMermaid(source, "dark"),
      back: await drawMermaid(source, "light"),
    }).toEqual({
      light: { svg: '<svg data-theme="default"></svg>' },
      dark: { svg: '<svg data-theme="dark"></svg>' },
      back: { svg: '<svg data-theme="default"></svg>' },
    });
  });

  it("#835 I1 two draws in different themes at once each get their own theme", async () => {
    const { drawMermaid } = await import("@/lib/mermaid");
    const source = "graph TD; a-->b";
    const light = drawMermaid(source, "light");
    const dark = drawMermaid(source, "dark");

    expect({ light: await light, dark: await dark }).toEqual({
      light: { svg: '<svg data-theme="default"></svg>' },
      dark: { svg: '<svg data-theme="dark"></svg>' },
    });
  });
});
