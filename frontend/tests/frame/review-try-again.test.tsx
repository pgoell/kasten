/**
 * The review's Try again button in the browser (#1163), at phone and desktop
 * width: the tap target a phone is held to, and a picture of the foot to look at.
 *
 * The deck's note is refused with a 500, which no read retries, so the foot says
 * the note could not be read and offers Try again at once.
 *
 * Skipped unless VITE_KASTEN_SHOTS is set; pictures land in
 * node_modules/.cache/kasten-shots.
 */

// The three faces `main.tsx` loads, so the pictures show the app's type.
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/instrument-sans/index.css";
import "@fontsource-variable/jetbrains-mono/index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { commands, page } from "vitest/browser";
import { ReviewSession } from "@/components/review-session";
import { readRetry } from "@/lib/read-retry";
import type { Deck } from "@/lib/review/review";
import { shot } from "./shots";
import "@/styles/app.css";

const SHOTS = Boolean(import.meta.env.VITE_KASTEN_SHOTS);
const DESKTOP = { width: 1440, height: 900, touch: false };
const PHONE = { width: 414, height: 896, touch: true };
type Size = typeof DESKTOP;

const NOTE = "decks/trivia.md";
const DECK: Deck = {
  name: "trivia",
  notes: [NOTE],
  due: 0,
  fresh: 20,
  parked: 0,
  whole: false,
  next: null,
};

const limits = vi.hoisted(() => ({ down: false }));

vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  fetchReviewLimits: () =>
    limits.down
      ? Promise.reject(new Error("GET /api/review/limits failed with 502", { cause: 502 }))
      : Promise.resolve({ new_per_day: null, reviews_per_day: null }),
  fetchNote: () =>
    Promise.reject(new Error(`GET /api/files/${NOTE} failed with 500`, { cause: 500 })),
}));

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** The foot's Try again button, once the deck read has failed and drawn it. */
function tryAgain(host: HTMLElement): HTMLButtonElement | undefined {
  return [...host.querySelectorAll("button")].find((button) => button.textContent === "Try again");
}

/** The sitting over the deck, drawn in a host of the size asked for. */
async function mountAt(size: Size) {
  await page.viewport(size.width, size.height);
  await commands.emulateMedia({ touch: size.touch, reducedMotion: "reduce" });
  document.documentElement.dataset.theme = "light";

  const host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh w-full";
  const root = createRoot(host);
  const ui: ReactElement = (
    <QueryClientProvider client={new QueryClient()}>
      <ReviewSession deck={DECK} onLeave={() => {}} />
    </QueryClientProvider>
  );
  root.render(ui);
  return { host, root };
}

afterEach(async () => {
  delete document.documentElement.dataset.theme;
  limits.down = false;
  vi.restoreAllMocks();
  await commands.emulateMedia({});
  await page.viewport(1280, 900);
});

/** The daily limits read fails for good: one refused read and no more, so the foot shows at once. */
function limitsDown() {
  limits.down = true;
  vi.spyOn(readRetry, "retry").mockReturnValue(false);
}

it("#1163 I5 at phone width 414 Try again is a tap target at least 44 px high", async () => {
  const { host, root } = await mountAt(PHONE);
  try {
    await expect
      .poll(() => tryAgain(host)?.getBoundingClientRect().height ?? 0)
      .toBeGreaterThanOrEqual(44);
    if (SHOTS) await shot(host, "review-try-again-414");
  } finally {
    root.unmount();
    host.remove();
  }
});

it("#1167 I5 at phone width 414 the limits Try again is a tap target at least 44 px high", async () => {
  limitsDown();
  const { host, root } = await mountAt(PHONE);
  try {
    await expect
      .poll(() => tryAgain(host)?.getBoundingClientRect().height ?? 0)
      .toBeGreaterThanOrEqual(44);
    if (SHOTS) await shot(host, "review-limits-try-again-414");
  } finally {
    root.unmount();
    host.remove();
  }
});

async function picture(name: string, size: Size): Promise<void> {
  const { host, root } = await mountAt(size);
  try {
    await expect.poll(() => tryAgain(host) !== undefined).toBe(true);
    await nextFrame();
    expect(await shot(host, name)).toBe(size.width);
  } finally {
    root.unmount();
    host.remove();
  }
}

it.skipIf(!SHOTS)(
  "review-try-again-1440",
  () => picture("review-try-again-1440", DESKTOP),
  120_000,
);

it.skipIf(!SHOTS)(
  "review-limits-try-again-1440",
  () => {
    limitsDown();
    return picture("review-limits-try-again-1440", DESKTOP);
  },
  120_000,
);
