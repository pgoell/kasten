/**
 * The folded deck list at phone and desktop width (#517).
 *
 * jsdom lays nothing out, so only a real browser can say the fold toggle is a
 * 44 px target and that a row with its toggle beside it still fits the
 * screen. One parent folded and one unfolded, so the pictures show both.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { page } from "vitest/browser";
import { ReviewDecks } from "@/components/review-decks";
import { shot } from "./shots";
import "@/styles/app.css";

const NOTES: Record<string, string> = {
  "t.md": [
    "#flashcards/trivia/geography",
    "What is the capital of France?::Paris",
    "Which river is the longest?::The Nile <!--SR:!2000-01-01,4,250-->",
  ].join("\n"),
  "h.md": "#flashcards/trivia/history\nWhen did Rome fall?::476",
  "d.md": [
    "#flashcards/databases/postgres",
    "What is MVCC?::A row per version",
    "What is the WAL?::The write-ahead log <!--SR:!2000-01-01,4,250-->",
  ].join("\n"),
  "a.md":
    "#flashcards/aws\nWhat is a VPC?::A private cloud\nWhat is S3?::Object storage !suspended",
};

const HITS = Object.entries(NOTES).flatMap(([path, text]) =>
  text.split("\n").map((line, at) => ({ path, line: at + 1, text: line })),
);

// The overview's reads, answered here and not by a server. `decks.md` and the
// default limits answer as a vault without them would, which is a refusal.
// The rest kept, as the browser checks every named import the graph holds.
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  fetchCards: () => Promise.resolve(HITS),
  fetchNote: (path: string) =>
    path in NOTES
      ? Promise.resolve(NOTES[path])
      : Promise.reject(new Error(`GET /api/files/${path} failed with 404`)),
  fetchReviewLimits: () => Promise.reject(new Error("GET /api/review/limits failed with 404")),
}));

afterEach(async () => {
  localStorage.clear();
  await page.viewport(414, 896);
});

it.each([
  ["phone", 414, 896],
  ["desktop", 1280, 900],
])(
  "#517 the folded deck list fits and folds by a 44 px target: %s",
  async (name, width, height) => {
    await page.viewport(width, height);
    localStorage.setItem("kasten.review.folds.1", JSON.stringify(["databases"]));
    const host = document.body.appendChild(document.createElement("div"));
    host.className = "h-dvh w-full";
    const root = createRoot(host);
    try {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <ReviewDecks onPick={() => {}} onParked={() => {}} />
        </QueryClientProvider>,
      );
      await expect.poll(() => host.querySelector('button[data-deck="aws"]')).not.toBeNull();

      const toggle = host.querySelector('button[data-fold="trivia"]');
      expect(toggle, "no fold toggle beside the trivia row").not.toBeNull();
      const box = (toggle as Element).getBoundingClientRect();
      expect(box.width, "toggle width").toBeGreaterThanOrEqual(44);
      expect(box.height, "toggle height").toBeGreaterThanOrEqual(44);

      // Trivia folded, databases unfolded, as the store says.
      expect(host.querySelector('button[data-deck="trivia/geography"]')).toBeNull();
      expect(host.querySelector('button[data-deck="databases/postgres"]')).not.toBeNull();

      const screen = document.documentElement.clientWidth;
      for (const row of host.querySelectorAll("li")) {
        expect(row.getBoundingClientRect().right, row.textContent ?? "").toBeLessThanOrEqual(
          screen,
        );
      }
      expect(document.documentElement.scrollWidth, "page scrolls sideways").toBeLessThanOrEqual(
        screen,
      );

      expect(await shot(host, `review-folds-${name}`)).toBe(width);
    } finally {
      root.unmount();
      host.remove();
    }
  },
);
