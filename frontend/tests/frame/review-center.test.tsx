/**
 * A centred card, with Undo in the header, at phone and desktop width (#600).
 *
 * jsdom lays nothing out, so only a real browser can say the text of the card
 * sits in the middle of the pane both ways, and that the header still fits a
 * phone with Undo and Center in it. The card on screen holds a sound, so
 * Replay is drawn too and the header is as full as it gets.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { page } from "vitest/browser";
import { ReviewSession } from "@/components/review-session";
import { shot } from "./shots";
import "@/styles/app.css";

const NOTE =
  "#flashcards/aws\n\nWhat is a VPC?::A private cloud\n\n" +
  "What does S3 stand for? ![](m/s3.mp3)::Simple Storage Service\n";

// The sitting's reads and writes, answered here and not by a server. The rest
// kept, as the browser checks every named import the graph holds.
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  fetchNote: (path: string) =>
    path === "decks/aws.md"
      ? Promise.resolve(NOTE)
      : Promise.reject(new Error(`GET /api/files/${path} failed with 404`)),
  saveNote: (path: string, content: string) => Promise.resolve({ path, content }),
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
  "#600 a centred card sits in the middle both ways and the header fits: %s",
  async (name, width, height) => {
    await page.viewport(width, height);
    localStorage.setItem("kasten.review.center", "on");
    const host = document.body.appendChild(document.createElement("div"));
    host.className = "h-dvh w-full";
    const root = createRoot(host);
    try {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <ReviewSession
            deck={{
              name: "aws",
              notes: ["decks/aws.md"],
              due: 0,
              fresh: 2,
              parked: 0,
              whole: false,
            }}
            onLeave={() => {}}
          />
        </QueryClientProvider>,
      );
      await expect
        .poll(() => host.querySelector('[data-testid="review-card"] .cm-line'))
        .not.toBeNull();
      (host.querySelector("footer button") as HTMLButtonElement).click();
      await expect.poll(() => host.querySelector('button[data-rating="good"]')).not.toBeNull();
      (host.querySelector('button[data-rating="good"]') as HTMLButtonElement).click();
      await expect
        .poll(() => host.querySelector('[data-testid="review-card"]')?.textContent ?? "")
        .toContain("What does S3 stand for?");

      const header = host.querySelector("header") as HTMLElement;
      const buttons = [...header.querySelectorAll("button")].map((button) => button.textContent);
      expect(buttons).toEqual(["← Decks", "Replay", "Undo", "Suspend", "Jot", "Type", "Center"]);

      // Across: the words of the question, not the block they sit in.
      const card = host.querySelector('[data-testid="review-card"]') as HTMLElement;
      const line = card.querySelector(".cm-line") as HTMLElement;
      const words = document.createRange();
      words.selectNodeContents(line);
      const text = words.getBoundingClientRect();
      const box = card.getBoundingClientRect();
      expect(
        Math.abs((text.left + text.right) / 2 - (box.left + box.right) / 2),
        "across",
      ).toBeLessThan(8);
      expect(text.left - box.left, "the question sits at the left edge").toBeGreaterThan(20);

      // Down: the card in the middle of the pane under the header.
      const pane = (card.parentElement as HTMLElement).getBoundingClientRect();
      expect(
        Math.abs((box.top + box.bottom) / 2 - (pane.top + pane.bottom) / 2),
        "down",
      ).toBeLessThan(8);

      const screen = document.documentElement.clientWidth;
      expect(header.scrollWidth, "header overflows").toBeLessThanOrEqual(header.clientWidth);
      for (const button of header.querySelectorAll("button")) {
        expect(button.getBoundingClientRect().right, button.textContent ?? "").toBeLessThanOrEqual(
          screen,
        );
      }
      expect(document.documentElement.scrollWidth, "page scrolls sideways").toBeLessThanOrEqual(
        screen,
      );

      expect(await shot(host, `review-center-${name}`)).toBe(width);
    } finally {
      root.unmount();
      host.remove();
    }
  },
);
