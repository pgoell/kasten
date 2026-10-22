/**
 * Pictures of the Today screen (#779) in an empty pane: three columns side by
 * side at 1440 and stacked at 390 with touch, in light and dark.
 *
 * Mounted with the note fixture in `reader-fixture.tsx`, so the columns read
 * the same todos and notes the reader tests do.
 */

import {
  DESKTOP,
  mountToday,
  need,
  picture,
  registerReaderFixture,
  TOUCH,
  unmount,
} from "./reader-fixture";

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    fetchFiles: vi.fn(),
    fetchNote: vi.fn(),
    saveNote: async (path: string, content: string) => ({ path, content }),
    searchNotes: vi.fn(),
    fetchTodos: vi.fn(),
    fetchImages: async () => [],
    fetchHtml: async () => [],
    fetchAssets: async () => [],
    fetchTags: async () => [],
    fetchTerminals: async () => [],
    fetchVersion: async () => "0.8.0",
    fetchWeather: async () => [],
  };
});

vi.mock("@/lib/trash-api", async (original) => ({
  ...(await original<typeof import("@/lib/trash-api")>()),
  fetchTrash: async () => [],
}));

vi.mock("@/lib/graph-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/graph-api")>()),
  fetchGraph: vi.fn(),
}));

registerReaderFixture();

it("today-desktop-1440 in light and dark", async () => {
  for (const theme of ["light", "dark"] as const) {
    const mounted = await mountToday(DESKTOP, theme);
    try {
      const { host } = mounted;
      const today = need(host.querySelector<HTMLElement>("section[data-today]"), "Today");
      expect(today.querySelector("h1")).not.toBeNull();

      // Three columns side by side: each one starts at the same height.
      const columns = [...today.querySelectorAll<HTMLElement>("[data-today-column]")];
      expect(columns).toHaveLength(3);
      const tops = columns.map((column) => column.getBoundingClientRect().top);
      const [first = 0] = tops;
      for (const top of tops) expect(Math.abs(top - first)).toBeLessThan(1);

      await picture(host, `today-desktop-1440-${theme}`, DESKTOP);
    } finally {
      await unmount(mounted);
    }
  }
}, 120_000);

it("today-touch-390 in light and dark", async () => {
  for (const theme of ["light", "dark"] as const) {
    const mounted = await mountToday(TOUCH, theme);
    try {
      const { host } = mounted;
      const today = need(host.querySelector<HTMLElement>("section[data-today]"), "Today");

      // Stacked: each column starts below the one before it.
      const columns = [...today.querySelectorAll<HTMLElement>("[data-today-column]")];
      expect(columns).toHaveLength(3);
      const tops = columns.map((column) => column.getBoundingClientRect().top);
      for (let index = 1; index < tops.length; index++) {
        expect(tops[index] ?? 0).toBeGreaterThan(tops[index - 1] ?? 0);
      }

      await picture(host, `today-touch-390-${theme}`, TOUCH);
    } finally {
      await unmount(mounted);
    }
  }
}, 120_000);
