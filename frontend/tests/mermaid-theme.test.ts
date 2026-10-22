/**
 * The theme mermaid is initialised with, read once when it loads (#835).
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
  default: { initialize, render: async () => ({ svg: "<svg></svg>" }) },
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
});
