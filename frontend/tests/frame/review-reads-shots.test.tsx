/**
 * Pictures of the review's failed reads (#1150, #1153), to look at by eye: the
 * parked list while its scan is out and after it fails, and the decks with a
 * note that could not be read, at desktop and phone width.
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
import { ReviewDecks } from "@/components/review-decks";
import { ReviewParked } from "@/components/review-parked";
import { shot } from "./shots";
import "@/styles/app.css";

const SHOTS = Boolean(import.meta.env.VITE_KASTEN_SHOTS);
const DESKTOP = { width: 1440, height: 900, touch: false };
const PHONE = { width: 414, height: 896, touch: true };
type Size = typeof DESKTOP;

// What the reads answer, set per picture. The mock reads it lazily.
const vault = vi.hoisted(() => ({
  notes: {} as Record<string, string>,
  scan: "answers" as "answers" | "out" | "fails",
  unread: [] as string[],
}));

// A status in `cause`, as the API puts it, and a 500, which no read retries.
const failed = (what: string) => new Error(`GET ${what} failed with 500`, { cause: 500 });

vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  fetchCards: () =>
    vault.scan === "out"
      ? new Promise(() => {})
      : vault.scan === "fails"
        ? Promise.reject(failed("/api/cards"))
        : Promise.resolve(
            Object.entries(vault.notes).flatMap(([path, text]) =>
              text.split("\n").map((line, at) => ({ path, line: at + 1, text: line })),
            ),
          ),
  fetchNote: (path: string) =>
    vault.unread.includes(path)
      ? Promise.reject(failed(`/api/files/${path}`))
      : path in vault.notes
        ? Promise.resolve(vault.notes[path] as string)
        : Promise.reject(new Error(`GET /api/files/${path} failed with 404`)),
  saveNote: (path: string, content: string) => Promise.resolve({ path, content }),
  fetchReviewLimits: () => Promise.reject(new Error("GET /api/review/limits failed with 404")),
}));

const DECKS = {
  "aws.md": [
    "#flashcards/aws",
    "",
    "What is a VPC?::A private cloud <!--SR:!2026-10-23,3,250-->",
    "",
    "What does S3 stand for?::Simple Storage Service",
  ].join("\n"),
  "spanish.md": ["#flashcards/spanish", "", "Hola::Hello", "", "Gracias::Thank you"].join("\n"),
  "databases.md": ["#flashcards/databases", "", "What is MVCC?::A row per version"].join("\n"),
};

interface Scene {
  scan: typeof vault.scan;
  unread: string[];
  mount: () => ReactElement;
  /** Waits for the line the picture shows. */
  settle: (host: HTMLElement) => Promise<void>;
}

const SCENES = {
  "parked-reading": {
    scan: "out",
    unread: [],
    mount: () => <ReviewParked onLeave={() => {}} onOpen={() => {}} />,
    settle: async (host) => {
      await expect.poll(() => host.textContent).toContain("Reading the notes");
    },
  },
  "parked-failed": {
    scan: "fails",
    unread: [],
    mount: () => <ReviewParked onLeave={() => {}} onOpen={() => {}} />,
    settle: async (host) => {
      await expect.poll(() => host.querySelector('[role="alert"]')).not.toBeNull();
    },
  },
  "decks-unread": {
    scan: "answers",
    unread: ["spanish.md", "databases.md"],
    mount: () => <ReviewDecks onPick={() => {}} onParked={() => {}} />,
    settle: async (host) => {
      await expect.poll(() => host.querySelector('[role="alert"]')).not.toBeNull();
    },
  },
} satisfies Record<string, Scene>;

type Screen = keyof typeof SCENES;

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function picture(name: string, screen: Screen, size: Size): Promise<void> {
  const scene: Scene = SCENES[screen];
  vault.notes = DECKS;
  vault.scan = scene.scan;
  vault.unread = scene.unread;
  await page.viewport(size.width, size.height);
  await commands.emulateMedia({ touch: size.touch, reducedMotion: "reduce" });
  document.documentElement.dataset.theme = "light";

  const host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh w-full";
  const root = createRoot(host);
  try {
    root.render(
      <QueryClientProvider client={new QueryClient()}>{scene.mount()}</QueryClientProvider>,
    );
    await scene.settle(host);
    await nextFrame();
    expect(await shot(host, name)).toBe(size.width);
  } finally {
    root.unmount();
    host.remove();
  }
}

afterEach(async () => {
  delete document.documentElement.dataset.theme;
  await commands.emulateMedia({});
  await page.viewport(1280, 900);
});

for (const screen of ["parked-reading", "parked-failed", "decks-unread"] as const) {
  for (const size of [DESKTOP, PHONE]) {
    const name = `review-${screen}-${size.width}`;
    it.skipIf(!SHOTS)(name, () => picture(name, screen, size), 120_000);
  }
}
