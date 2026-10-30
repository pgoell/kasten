/**
 * A grade's base is hashed in a worker (#1384), against a vault that refuses a
 * write whose base is not the sha256 of the text it holds, so a landing proves
 * the base. A real browser, since jsdom has no Worker.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot, type Root } from "react-dom/client";
import { ReviewSession } from "@/components/review-session";
import { noteBase, noteBaseAside } from "@/lib/note-base";
import type { Deck } from "@/lib/review/review";
import "@/styles/app.css";

const FILLER = "Filler for a base fixture, long enough to be a real deck. ".repeat(4);
const DECK_TEXT = `---\nmodified: 2026-10-30T00:00:00\n---\n#flashcards/big\n\n${Array.from(
  { length: 300 },
  (_, index) => `Question ${index + 1}::Answer ${index + 1}. ${FILLER}`,
).join("\n\n")}\n`;

const DECK: Deck = {
  name: "big",
  notes: ["decks/big.md"],
  due: 0,
  fresh: 300,
  parked: 0,
  whole: false,
  next: null,
};

const vault = vi.hoisted(() => ({
  text: "",
  sent: [] as string[],
  refused: 0,
  hold: null as Promise<void> | null,
}));

vi.mock("@/lib/api", async (original) => {
  const api = await original<typeof import("@/lib/api")>();
  return {
    ...api,
    fetchNote: (path: string) =>
      path === "decks/big.md"
        ? Promise.resolve(vault.text)
        : Promise.reject(new Error(`GET /api/files/${path} failed with 404`)),
    // The backend's check: the base must be the hash of the note it holds. It restamps `modified`.
    saveNote: async (path: string, content: string, _keepalive: boolean, base: string) => {
      if (vault.hold) await vault.hold;
      if (base !== noteBase(vault.text)) {
        vault.refused += 1;
        throw new api.ChangedOnDisk();
      }
      vault.sent.push(content);
      vault.text = content.replace(
        /^modified: .*$/m,
        `modified: 2026-10-30T01:00:${vault.sent.length}`,
      );
      return { path, content: vault.text };
    },
    fetchReviewLimits: () => Promise.reject(new Error("GET /api/review/limits failed with 404")),
  };
});

let root: Root | undefined;
let host: HTMLElement | undefined;

beforeEach(() => {
  localStorage.clear();
  vault.text = DECK_TEXT;
  vault.sent = [];
  vault.refused = 0;
  vault.hold = null;
});

afterEach(() => {
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
  vi.unstubAllGlobals();
});

async function mount(): Promise<HTMLElement> {
  const div = document.body.appendChild(document.createElement("div"));
  div.className = "h-dvh w-full";
  host = div;
  root = createRoot(div);
  root.render(
    <QueryClientProvider client={new QueryClient()}>
      <ReviewSession deck={DECK} onLeave={() => {}} />
    </QueryClientProvider>,
  );
  await expect
    .poll(() => div.querySelector('[data-testid="review-card"] .cm-line'), { timeout: 30_000 })
    .not.toBeNull();
  return div;
}

/** Turns the card and grades it good, without waiting for its write. */
async function grade(screen: HTMLElement): Promise<void> {
  (screen.querySelector("footer button") as HTMLButtonElement).click();
  await expect.poll(() => screen.querySelector('button[data-rating="good"]')).not.toBeNull();
  (screen.querySelector('button[data-rating="good"]') as HTMLButtonElement).click();
  await expect.poll(() => screen.querySelector('button[data-rating="good"]')).toBeNull();
}

/** Grades `count` cards, each write landed before the next grade. */
async function grades(count: number): Promise<string[]> {
  const screen = await mount();
  for (let step = 1; step <= count; step++) {
    await grade(screen);
    await expect.poll(() => vault.sent.length).toBe(step);
  }
  return [...vault.sent];
}

/** A Worker that fails once asked, the way a worker that dies mid-sitting does. */
class Failing {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessageerror: ((event: Event) => void) | null = null;
  postMessage() {
    setTimeout(() => this.onerror?.(new Event("error")));
  }
  terminate() {}
}

// These two run first: the hash keeps one worker for the page, and a failure is what drops it.
it("#1384 A6 a worker that cannot start leaves the hash to the main thread, and the grades land", async () => {
  vi.stubGlobal(
    "Worker",
    class {
      constructor() {
        throw new DOMException("refused", "SecurityError");
      }
    },
  );
  await grades(2);
  expect(vault.refused).toBe(0);
});

it("#1384 A6 a worker that fails mid-sitting leaves the hash to the main thread, and the grades land", async () => {
  vi.stubGlobal("Worker", Failing);
  await grades(2);
  expect(vault.refused).toBe(0);
});

it("#1384 A2 A5 every grade in a sitting names the vault's text, and writes what a main-thread hash writes", async () => {
  const viaWorker = await grades(4);
  expect(vault.refused).toBe(0);
  root?.unmount();
  root = undefined;
  vault.text = DECK_TEXT;
  vault.sent = [];
  vi.stubGlobal("Worker", undefined);
  expect(await grades(4)).toEqual(viaWorker);
});

it("#1384 A3 a second grade before the first write lands waits, and names its answer", async () => {
  const screen = await mount();
  let release = () => {};
  vault.hold = new Promise((done) => {
    release = done;
  });
  await grade(screen);
  await grade(screen);
  vault.hold = null;
  release();
  await expect.poll(() => vault.sent.length).toBe(2);
  expect(vault.refused).toBe(0);
});

it("#1384 A4 a note changed outside the sitting refuses the grade, and the grade after the re-read lands", async () => {
  const screen = await mount();
  await grade(screen);
  await expect.poll(() => vault.sent.length).toBe(1);
  vault.text = vault.text.replace("Question 300::", "Question 300 edited::");
  await grade(screen);
  await expect.poll(() => vault.refused).toBe(1);
  await expect.poll(() => screen.textContent).toMatch(/changed|could not/i);
  await grade(screen);
  await expect.poll(() => vault.sent.length).toBe(2);
  expect(vault.refused).toBe(1);
  expect(vault.text).toContain("Question 300 edited::");
});

it("#1384 I1 a write whose hash is out when the sitting unmounts still lands", async () => {
  const screen = await mount();
  await grade(screen);
  root?.unmount();
  root = undefined;
  await expect.poll(() => vault.sent.length).toBe(1);
  expect(vault.refused).toBe(0);
});

it("#1384 I4 an undo pressed while the grade's hash is out waits, and names the grade's answer", async () => {
  const screen = await mount();
  await grade(screen);
  [...screen.querySelectorAll("button")]
    .find((each) => /undo/i.test(each.textContent ?? ""))
    ?.click();
  await expect.poll(() => vault.sent.length).toBe(2);
  expect(vault.refused).toBe(0);
  expect(vault.sent[1]).toBe(DECK_TEXT);
});

it("#1384 I2 hashes asked at once each get their own text's base, stamps, CRLF and all", async () => {
  const texts = [
    DECK_TEXT,
    "---\r\nid: x\r\nmodified: 2026-01-01\r\n---\r\nÜnïcode 🙂\r\n",
    "---\nmodified: 2026-10-30\n---\nbody",
    "",
  ];
  const asked = texts.map(noteBaseAside);
  // Promises, so the worker hashed them and not this thread.
  expect(asked.every((each) => each instanceof Promise)).toBe(true);
  expect(await Promise.all(asked)).toEqual(texts.map(noteBase));
});
