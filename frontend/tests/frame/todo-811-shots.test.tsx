/**
 * Pictures of the overview and board redesign (#811), to look at by eye: the list on
 * a phone and a desktop, the board by kind and by project, the phone's state tabs and
 * its swipe mid-way and past the edge, the shared toggle, and the palettes and
 * reduced motion. Skipped unless VITE_KASTEN_SHOTS=1; pictures land in
 * node_modules/.cache/kasten-shots.
 */

// The three faces `main.tsx` loads, so the pictures show the app's type.
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/instrument-sans/index.css";
import "@fontsource-variable/jetbrains-mono/index.css";
import { commands } from "vitest/browser";
import { applyTheme, PALETTE_KEY, THEME_KEY, type Theme } from "@/lib/theme";
import { DEFAULT_VIEWS } from "@/lib/todo-view";
import { SHARED_KEY } from "@/lib/use-todo-filter";
import { shot } from "./shots";
import {
  click,
  FILES,
  HITS,
  mount,
  pagePoint,
  press,
  touchDown,
  touchTo,
  touchUp,
} from "./todo-811-fixture";

// The warn of #1001: the warn token each palette and theme sets in kasten-theme.css. The
// waiting box must paint this value, so update it whenever the token changes.
type WarnKey = "russet-light" | "russet-dark" | "peach-light" | "peach-dark";
const EXPECTED_WARN: Record<WarnKey, string> = {
  "russet-light": "#806b00",
  "russet-dark": "#c3b064",
  "peach-light": "#766d48",
  "peach-dark": "#b9b188",
};

/** The `rgb(r, g, b)` a browser reports for a `#rrggbb` colour, as it reports fill and stroke. */
const rgbOf = (hex: string): string => {
  const channel = (start: number) => Number.parseInt(hex.slice(start, start + 2), 16);
  return `rgb(${channel(1)}, ${channel(3)}, ${channel(5)})`;
};

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

type Step = (host: HTMLElement) => Promise<void>;

interface Picture {
  /** The picture's file name, and the test's name after `shot`. */
  name: string;
  size: { width: number; height: number; coarse: boolean };
  theme: Theme;
  palette?: string;
  reduced?: boolean;
  /** The board rather than the list. */
  board?: boolean;
  /** The shared lists shown, as the toggle stores them. */
  shared?: boolean;
  /** What is done after the pane draws, before the picture is taken. */
  steps?: Step;
  /** A finger still down on the column while the picture is taken, lifted after. */
  held?: boolean;
}

/** The fold of Done this week, the list's only folding heading. */
const unfoldDone: Step = async (host) => {
  await clickHeading(host);
};

/** The first lane's heading, which folds the lane. */
const foldFirstLane: Step = async (host) => {
  await clickHeading(host);
};

/** The first heading that folds, brought into view first, since a phone's list runs past the screen. */
async function clickHeading(host: HTMLElement): Promise<void> {
  const heading = host.querySelector<HTMLElement>("h3 button[aria-expanded]");
  if (!heading) throw new Error("no folding heading on the page");
  heading.scrollIntoView({ block: "center" });
  await click(heading);
}

/** The board's lanes by project, `g` as the pane's keys switch them. */
const byProject: Step = async (host) => {
  press(host, "g");
};

/** The card under the first column's cursor, which a finger starts on. */
function firstCard(host: HTMLElement): HTMLElement {
  const card = host.querySelector<HTMLElement>("[data-card]");
  if (!card) throw new Error("no card on the board");
  return card;
}

/** The column a swipe moves: the one after the state tabs. */
function swipedColumn(host: HTMLElement): HTMLElement {
  const column = host.querySelector<HTMLElement>("[role='tablist'] + div");
  if (!column) throw new Error("no swipe column on the page");
  return column;
}

/** A finger down on the first card and dragged 120 px left, left held. */
const midSwipe: Step = async (host) => {
  const [x, y] = pagePoint(firstCard(host));
  await touchDown(x, y);
  await touchTo(x - 120, y);
  // The move is drawn a frame after the call returns, so the picture waits for it.
  await expect.poll(() => swipedColumn(host).style.transform).not.toBe("");
};

/** A finger down on the first column and dragged 150 px right, past the edge, left held. */
const rubber: Step = async (host) => {
  const [x, y] = pagePoint(firstCard(host));
  await touchDown(x, y);
  await touchTo(x + 150, y);
  await expect.poll(() => swipedColumn(host).style.transform).not.toBe("");
};

const PICTURES: Picture[] = [
  { name: "phone-list-light", size: PHONE, theme: "light", steps: unfoldDone },
  { name: "phone-list-dark", size: PHONE, theme: "dark", steps: unfoldDone },
  { name: "desktop-list-light", size: DESKTOP, theme: "light", steps: unfoldDone },
  { name: "desktop-list-dark", size: DESKTOP, theme: "dark", steps: unfoldDone },
  {
    name: "desktop-board-kind-light",
    size: DESKTOP,
    theme: "light",
    board: true,
    steps: foldFirstLane,
  },
  {
    name: "desktop-board-project-dark",
    size: DESKTOP,
    theme: "dark",
    board: true,
    steps: async (host) => {
      await byProject(host);
      await foldFirstLane(host);
    },
  },
  { name: "phone-board-tabs-light", size: PHONE, theme: "light", board: true },
  { name: "phone-board-tabs-dark", size: PHONE, theme: "dark", board: true },
  {
    name: "phone-board-midswipe-light",
    size: PHONE,
    theme: "light",
    board: true,
    steps: midSwipe,
    held: true,
  },
  {
    name: "phone-board-rubber-light",
    size: PHONE,
    theme: "light",
    board: true,
    steps: rubber,
    held: true,
  },
  {
    name: "phone-list-shared-on-light",
    size: PHONE,
    theme: "light",
    shared: true,
    steps: unfoldDone,
  },
  { name: "phone-list-shared-off-light", size: PHONE, theme: "light", steps: unfoldDone },
  {
    name: "desktop-list-russet",
    size: DESKTOP,
    theme: "light",
    palette: "russet",
    steps: unfoldDone,
  },
  {
    name: "phone-board-pansy-dark",
    size: PHONE,
    theme: "dark",
    palette: "pansy",
    board: true,
  },
  { name: "desktop-board-peach", size: DESKTOP, theme: "light", palette: "peach", board: true },
  {
    name: "desktop-list-reduced-motion",
    size: DESKTOP,
    theme: "light",
    reduced: true,
    steps: unfoldDone,
  },
];

/** One picture, once its rows and entrances have settled, and its width checked. */
async function shoot(picture: Picture): Promise<void> {
  const { size } = picture;
  fetchTodos.mockResolvedValue(HITS);
  fetchFiles.mockResolvedValue(FILES);
  fetchNote.mockResolvedValue(DEFAULT_VIEWS);
  createNote.mockResolvedValue(undefined);
  searchNotes.mockResolvedValue([]);

  localStorage.clear();
  localStorage.setItem(THEME_KEY, picture.theme);
  localStorage.setItem(PALETTE_KEY, picture.palette ?? "poel");
  if (picture.shared) localStorage.setItem(SHARED_KEY, "1");
  applyTheme();
  await commands.emulateMedia({
    touch: size.coarse,
    reducedMotion: picture.reduced ? "reduce" : "no-preference",
  });

  const pane = await mount(size.width, size.height, {
    coarse: size.coarse,
    board: picture.board,
  });
  try {
    if (picture.steps) await picture.steps(pane.host as HTMLElement);
    // The rows arrive on a stagger, so the picture waits for the end state.
    await Promise.all(document.getAnimations().map((animation) => animation.finished));
    await document.fonts.ready;
    expect(await shot(pane.host, picture.name)).toBe(size.width);
    if (picture.held) await touchUp();
  } finally {
    pane.unmount();
    // The next test in this browser page would still read the touch and motion set here.
    await commands.emulateMedia({});
  }
}

/** A picture test that runs only when pictures are asked for. */
function shotTest(picture: Picture) {
  it.skipIf(!SHOTS)(`shot ${picture.name}`, () => shoot(picture), 300_000);
}

/** The phone shows one column, so the waiting state's tab is pressed to bring its card up. */
const waitingTab: Step = async (host) => {
  const tab = [...host.querySelectorAll<HTMLElement>("[role='tab']")].find((one) =>
    one.textContent?.startsWith("Waiting"),
  );
  if (!tab) throw new Error("no waiting tab on the phone board");
  await click(tab);
};

/** The board's waiting card is on the page, and on a phone the waiting tab is the one selected. */
function expectWaitingCard(host: HTMLElement, phone: boolean): void {
  const card = [...host.querySelectorAll<HTMLElement>("[data-card]")].find((one) =>
    one.textContent?.includes("send the invoice"),
  );
  if (!card) throw new Error("no waiting card on the board");
  if (phone) {
    const selected = host.querySelector<HTMLElement>("[role='tab'][aria-selected='true']");
    expect(selected?.textContent?.startsWith("Waiting")).toBe(true);
  }
}

/** The list's waiting row, brought into view, whose state box must paint the warn token. */
const expectListWaiting =
  (key: WarnKey): Step =>
  async (host) => {
    const row = [...host.querySelectorAll<HTMLElement>("[data-row]")].find((one) =>
      one.textContent?.includes("send the invoice"),
    );
    if (!row) throw new Error("no waiting row on the list");
    row.scrollIntoView({ block: "center" });
    const box = row.querySelector<SVGElement>("[data-state='waiting'] .stroke-k-warn");
    if (!box) throw new Error("no waiting state box on the row");
    expect(getComputedStyle(box).stroke).toBe(rgbOf(EXPECTED_WARN[key]));
  };

for (const palette of ["russet", "peach"]) {
  for (const theme of ["light", "dark"] as const) {
    for (const device of ["desktop", "phone"] as const) {
      PICTURES.push({
        name: `board-waiting-${palette}-${theme}-${device}`,
        size: device === "phone" ? PHONE : DESKTOP,
        theme,
        palette,
        board: true,
        steps: async (host) => {
          if (device === "phone") await waitingTab(host);
          expectWaitingCard(host, device === "phone");
        },
      });
    }
    PICTURES.push({
      name: `list-waiting-${palette}-${theme}-desktop`,
      size: DESKTOP,
      theme,
      palette,
      steps: expectListWaiting(`${palette}-${theme}` as WarnKey),
    });
  }
}

for (const picture of PICTURES) shotTest(picture);
