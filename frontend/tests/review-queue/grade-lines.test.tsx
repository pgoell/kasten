import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReviewSession } from "@/components/review-session";
import * as api from "@/lib/api";
import { noteBase } from "@/lib/note-base";
import type { Deck } from "@/lib/review/review";
import { shownCard } from "../review-card";
import { DECK } from "../review-session-fixture";

const NOTE =
  "#flashcards/aws\n\nWhat is a VPC?\n?\nA private cloud\n\nWhat is S3?::Storage\n\nWhat is IAM?::Identity\n";
const ALL_NEW: Deck = { ...DECK, fresh: 3 };
const DECKS = "99 Misc/01 Config/decks.md";
const COMMENT = String.raw`<!--SR:!\d{4}-\d{2}-\d{2},\d+,\d+-->`;
const FRONT = /^---\n[\s\S]*?\n---\n/;

// The note as the expected text reads once each card's comment is `<SR>`, with the frontmatter left out.
const after1 =
  "#flashcards/aws\n\nWhat is a VPC?\n?\nA private cloud\n<SR>\n\nWhat is S3?::Storage\n\nWhat is IAM?::Identity\n";
const after2 =
  "#flashcards/aws\n\nWhat is a VPC?\n?\nA private cloud\n<SR>\n\nWhat is S3?::Storage <SR>\n\nWhat is IAM?::Identity\n";
const after3 =
  "#flashcards/aws\n\nWhat is a VPC?\n?\nA private cloud\n<SR>\n\nWhat is S3?::Storage <SR>\n\nWhat is IAM?::Identity <SR>\n";

/** The vault's answer: a frontmatter block whose `modified` line moves on every save, with `keep` lines beside it. */
function stamp(content: string, save: number, keep: string): string {
  return `---\n${keep}modified: 2026-10-30T10:00:0${save}\n---\n${content.replace(FRONT, "")}`;
}

/** The note as a test reads it: frontmatter left out, each schedule comment shown as `<SR>`. */
function marked(disk: string): string {
  return disk.replace(FRONT, "").replace(new RegExp(COMMENT, "g"), "<SR>");
}

/**
 * The sitting over a vault holding one note, stamped on every save.
 *
 * The vault refuses a write whose base is not the hash of the text it holds, as the backend's
 * conditional `PUT` does. `commit` is the vault's side of a save, so a test can hold one in flight.
 */
function renderVault(keep = "") {
  const vault = { disk: NOTE };
  let saves = 0;
  const commit = (path: string, content: string, base?: string) => {
    if (base !== noteBase(vault.disk)) throw new api.ChangedOnDisk();
    saves += 1;
    vault.disk = stamp(content, saves, keep);
    return { path, content: vault.disk };
  };
  vi.spyOn(api, "fetchReviewLimits").mockResolvedValue({
    new_per_day: null,
    reviews_per_day: null,
  });
  vi.spyOn(api, "fetchNote").mockImplementation(async (path: string) =>
    path === DECKS ? "" : vault.disk,
  );
  const saved = vi
    .spyOn(api, "saveNote")
    .mockImplementation(async (path: string, content: string, _keep?: boolean, base?: string) =>
      commit(path, content, base),
    );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ReviewSession deck={ALL_NEW} onLeave={vi.fn()} />
    </QueryClientProvider>,
  );
  return { vault, saved, commit };
}

/** The card on screen once it shows `question`, with its view mounted. */
async function backOn(question: string) {
  await waitFor(() => expect(screen.getByTestId("review-card")).toHaveTextContent(question));
  await shownCard();
}

/** Turn the card and rate it, then wait for the card `next` to come up. */
async function grade(name: string, next?: string) {
  fireEvent.click(screen.getByRole("button", { name: "Show the answer" }));
  fireEvent.click(screen.getByRole("button", { name }));
  if (next !== undefined) await backOn(next);
}

describe("ReviewSession grades to the card's line (#1379)", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("#1379 A4 three grades in one sitting each write the card's own line, with the vault stamping every answer", async () => {
    const { vault, saved } = renderVault();
    await shownCard();

    await grade("Good", "What is S3?");
    await waitFor(() => expect(marked(vault.disk)).toBe(after1));
    await grade("Good", "What is IAM?");
    await waitFor(() => expect(marked(vault.disk)).toBe(after2));
    await grade("Good");
    await waitFor(() => expect(marked(vault.disk)).toBe(after3));

    expect(saved).toHaveBeenCalledTimes(3);
  });

  it("#1379 A5 a second grade before the first write lands goes to the second card's line", async () => {
    const { vault, saved, commit } = renderVault();
    await shownCard();
    let release: () => void = () => {};
    saved.mockImplementationOnce(
      (path: string, content: string, _keep?: boolean, base?: string) =>
        new Promise((resolve) => {
          release = () => resolve(commit(path, content, base));
        }),
    );

    await grade("Good", "What is S3?");
    await grade("Good");
    expect(saved).toHaveBeenCalledTimes(1);
    expect(vault.disk).toBe(NOTE);

    await act(async () => release());
    await waitFor(() => expect(marked(vault.disk)).toBe(after2));
    expect(saved).toHaveBeenCalledTimes(2);
  });

  it("#1379 A6 a note edited under the open sitting is read again, and the next grade lands on its line", async () => {
    const { vault, saved } = renderVault();
    await shownCard();
    vault.disk = vault.disk.replace("#flashcards/aws\n", "#flashcards/aws\nExtra line\n");
    const reads = () =>
      vi.mocked(api.fetchNote).mock.calls.filter(([path]) => path === "decks/aws.md").length;

    await grade("Good", "What is S3?");
    await waitFor(() => expect(reads()).toBe(2));
    await expect(saved.mock.results[0]?.value).rejects.toBeInstanceOf(api.ChangedOnDisk);

    await grade("Good");
    await waitFor(() =>
      expect(marked(vault.disk)).toBe(
        "#flashcards/aws\nExtra line\n\nWhat is a VPC?\n?\nA private cloud\n\nWhat is S3?::Storage <SR>\n\nWhat is IAM?::Identity\n",
      ),
    );
  });

  it("#1379 I1 an undo after a grade puts the cards back, and the next grade lands on its line", async () => {
    const { vault, saved } = renderVault();
    await shownCard();
    await grade("Good");
    await waitFor(() => expect(marked(vault.disk)).toBe(after1));

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await backOn("What is a VPC?");
    await waitFor(() => expect(marked(vault.disk)).toBe(NOTE));

    fireEvent.click(screen.getByRole("button", { name: "Easy" }));
    await backOn("What is S3?");
    await grade("Good");
    await waitFor(() => expect(marked(vault.disk)).toBe(after2));
    expect(saved).toHaveBeenCalledTimes(4);
  });

  it("#1379 I2 a stamp that adds lines is read again, and the next grade lands on its line", async () => {
    const { vault, saved } = renderVault("id: x\ncreated: y\n");
    await shownCard();

    await grade("Good", "What is S3?");
    await waitFor(() => expect(marked(vault.disk)).toBe(after1));
    await grade("Good", "What is IAM?");
    await waitFor(() => expect(marked(vault.disk)).toBe(after2));
    await grade("Good");
    await waitFor(() => expect(marked(vault.disk)).toBe(after3));

    expect(vault.disk.startsWith("---\nid: x\ncreated: y\nmodified: ")).toBe(true);
    expect(saved).toHaveBeenCalledTimes(3);
  });
});
