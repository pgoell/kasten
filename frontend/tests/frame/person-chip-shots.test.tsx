/**
 * Pictures of the assignee chip (#809), to look at by eye: the todo pane on a
 * phone and a desktop, the board, a person's card, and the palettes and reduced
 * motion the chip has to hold in. Skipped unless VITE_KASTEN_SHOTS=1; pictures land
 * in node_modules/.cache/kasten-shots.
 */

// The three faces `main.tsx` loads, so the pictures show the app's type.
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/instrument-sans/index.css";
import "@fontsource-variable/jetbrains-mono/index.css";
import { commands } from "vitest/browser";
import { applyTheme, PALETTE_KEY, THEME_KEY, type Theme } from "@/lib/theme";
import { DEFAULT_VIEWS } from "@/lib/todo-view";
import { FILES, HITS, mount, mountCard, PEOPLE } from "./person-chip-fixture";
import { shot } from "./shots";

const SHOTS = import.meta.env.VITE_KASTEN_SHOTS === "1";

const { fetchTodos, fetchNote, fetchFiles, createNote, searchNotes } = vi.hoisted(() => ({
  fetchTodos: vi.fn(),
  fetchNote: vi.fn(),
  fetchFiles: vi.fn(),
  createNote: vi.fn(),
  searchNotes: vi.fn(),
}));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  fetchTodos,
  fetchNote,
  fetchFiles,
  createNote,
  searchNotes,
}));

const PHONE = { width: 390, height: 844, coarse: true };
const DESKTOP = { width: 1440, height: 900, coarse: false };

interface Picture {
  /** The picture's file name, and the test's name after `shot`. */
  name: string;
  size: { width: number; height: number; coarse: boolean };
  theme: Theme;
  palette?: string;
  /** The board rather than the list. */
  board?: boolean;
  /** Pascal's note with its card under it, rather than the pane. */
  card?: boolean;
  reduced?: boolean;
}

const PICTURES: Picture[] = [
  { name: "phone-pane-light", size: PHONE, theme: "light" },
  { name: "phone-pane-dark", size: PHONE, theme: "dark" },
  { name: "desktop-pane-light", size: DESKTOP, theme: "light" },
  { name: "desktop-board-light", size: DESKTOP, theme: "light", board: true },
  { name: "desktop-board-dark", size: DESKTOP, theme: "dark", board: true },
  { name: "person-card-light", size: DESKTOP, theme: "light", card: true },
  { name: "desktop-pane-russet", size: DESKTOP, theme: "light", palette: "russet" },
  { name: "desktop-board-peach", size: DESKTOP, theme: "light", palette: "peach", board: true },
  { name: "phone-pane-pansy", size: PHONE, theme: "light", palette: "pansy" },
  { name: "desktop-pane-reduced-motion", size: DESKTOP, theme: "light", reduced: true },
  { name: "phone-board-light", size: PHONE, theme: "light", board: true },
];

/** One picture, once its rows and entrances have settled, and its width checked. */
async function shoot(picture: Picture): Promise<void> {
  const { size } = picture;
  fetchTodos.mockResolvedValue(HITS);
  fetchFiles.mockResolvedValue(FILES);
  fetchNote.mockImplementation(async (path: string) => PEOPLE[path] ?? DEFAULT_VIEWS);
  createNote.mockResolvedValue(undefined);
  searchNotes.mockResolvedValue([]);

  localStorage.clear();
  localStorage.setItem(THEME_KEY, picture.theme);
  localStorage.setItem(PALETTE_KEY, picture.palette ?? "poel");
  applyTheme();
  await commands.emulateMedia({
    touch: size.coarse,
    reducedMotion: picture.reduced ? "reduce" : "no-preference",
  });

  const mounted = picture.card
    ? await mountCard(size.width, size.height)
    : await mount(size.width, size.height, { coarse: size.coarse, board: picture.board });
  try {
    // The lines arrive on a stagger, so the picture waits for the end state.
    await Promise.all(document.getAnimations().map((animation) => animation.finished));
    await document.fonts.ready;
    expect(await shot(mounted.host, picture.name)).toBe(size.width);
  } finally {
    mounted.unmount();
    // The next test in this browser page would still read the touch and motion set here.
    await commands.emulateMedia({});
  }
}

/** A picture test that runs only when pictures are asked for. */
function shotTest(picture: Picture) {
  it.skipIf(!SHOTS)(`shot ${picture.name}`, () => shoot(picture), 300_000);
}

for (const picture of PICTURES) shotTest(picture);
