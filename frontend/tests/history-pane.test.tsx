import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Mock } from "vitest";
import { HistoryPane } from "@/components/history-pane";
import { stubCommands } from "./stub-commands";

// The module and not `fetch`, the way the exam pane's tests do: what the pane
// owns is what it asks the vault for.
const { fetchNote, fetchHistory, fetchHistoryText } = vi.hoisted(() => ({
  fetchNote: vi.fn(),
  fetchHistory: vi.fn(),
  fetchHistoryText: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ fetchNote }));
vi.mock("@/lib/history-api", () => ({ fetchHistory, fetchHistoryText }));

const NOTE = "notes/plan.md";
const NOW = "---\nid: 1\nmodified: 2026-10-17T10:00:00+02:00\n---\nline one\nline two, now\n";
/** The newest change: the note as it was before the last edit. */
const NEWEST = "---\nid: 1\nmodified: 2026-10-16T09:30:00+02:00\n---\nline one\nline two\n";
/** The oldest change, from before the note was moved to its path. */
const OLDEST = "line one\n";

const CHANGES = [
  {
    commit: "a".repeat(40),
    change: "kxyzkxyz",
    time: "2026-10-16T09:30:00+02:00",
    description: "edit the second line",
    path: NOTE,
  },
  {
    commit: "b".repeat(40),
    change: "lmnolmno",
    time: "2026-10-15T08:00:00+02:00",
    description: "first draft",
    path: "old/plan.md",
  },
];

beforeEach(() => {
  fetchNote.mockReset();
  fetchHistory.mockReset();
  fetchHistoryText.mockReset();
  fetchNote.mockResolvedValue(NOW);
  fetchHistory.mockResolvedValue({ versioned: true, changes: CHANGES });
  fetchHistoryText.mockImplementation(async (_path: string, commit: string) =>
    commit === CHANGES[0]?.commit ? NEWEST : OLDEST,
  );
});

type Restore = Mock<(text: string, against: string) => Promise<string | null>>;

function open(onRestore: Restore = vi.fn(async () => null)) {
  const commands = stubCommands();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <HistoryPane note={NOTE} commands={commands} focusSignal={1} onRestore={onRestore} />
    </QueryClientProvider>,
  );
  return { commands, onRestore, client };
}

function pane(): HTMLElement {
  const found = document.querySelector("[data-history-pane]");
  if (found === null) throw new Error("no history pane");
  return found as HTMLElement;
}

function press(key: string, init?: KeyboardEventInit) {
  fireEvent.keyDown(pane(), { key, ...init });
}

const rows = () => screen.getAllByRole("option");
const diff = () => screen.getByTestId("history-diff").textContent;
const said = () => pane().querySelector("output")?.textContent ?? "";

/** The pane open and the newest change's diff drawn. */
async function opened(onRestore?: Restore) {
  const result = open(onRestore);
  await waitFor(() => expect(diff()).toContain("+line two"));
  return result;
}

describe("HistoryPane", () => {
  it("#425 A1 lists the changes newest first, each with its local time and description", async () => {
    await opened();

    const [first, second] = rows();
    expect(first).toHaveTextContent("edit the second line");
    expect(second).toHaveTextContent("first draft");
    const local = (time: string) =>
      new Date(time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    expect(first).toHaveTextContent(local("2026-10-16T09:30:00+02:00"));
    expect(second).toHaveTextContent(local("2026-10-15T08:00:00+02:00"));
  });

  it("#425 A2 shows the old path on a change from before the note moved, and reads it there", async () => {
    await opened();

    const [first, second] = rows();
    expect(first).not.toHaveTextContent("old/plan.md");
    expect(second).toHaveTextContent("old/plan.md");

    fireEvent.click(second as HTMLElement);
    await waitFor(() => expect(diff()).toContain("-line two, now"));
    expect(fetchHistoryText).toHaveBeenCalledWith("old/plan.md", "b".repeat(40));
  });

  it("#425 A3 opens on the newest change, drawn against the note now", async () => {
    await opened();

    expect(fetchHistoryText).toHaveBeenCalledWith(NOTE, "a".repeat(40));
    expect(rows()[0]).toHaveAttribute("aria-current", "true");
    // What a restore takes away, and what it brings back.
    expect(diff()).toContain("-line two, now");
    expect(diff()).toContain("+line two");
    // The stamp differs between any two copies, and is no change anybody made.
    expect(diff()).not.toContain("modified");
  });

  it("#425 A3 a click on a change shows its diff", async () => {
    await opened();

    fireEvent.click(rows()[1] as HTMLElement);

    // The oldest has no frontmatter, so the block is what it takes away.
    await waitFor(() => expect(diff()).toContain("-id: 1"));
    expect(rows()[1]).toHaveAttribute("aria-current", "true");
    expect(diff()).toContain("-line two, now");
    expect(diff()).not.toContain("+line two");
  });

  it("#425 I5 j and k move the pick, and Enter shows that change's diff", async () => {
    await opened();

    press("j");
    expect(rows()[1]).toHaveAttribute("aria-selected", "true");
    // Moving alone shows nothing new: the diff is still the newest's.
    expect(rows()[0]).toHaveAttribute("aria-current", "true");
    press("Enter");
    await waitFor(() => expect(rows()[1]).toHaveAttribute("aria-current", "true"));
    press("k");
    expect(rows()[0]).toHaveAttribute("aria-selected", "true");
  });

  it("#425 I5 the arrow keys move the pick the way j and k do", async () => {
    await opened();

    press("ArrowDown");
    expect(rows()[1]).toHaveAttribute("aria-selected", "true");
    press("ArrowUp");
    expect(rows()[0]).toHaveAttribute("aria-selected", "true");
  });

  it("#425 I5 Escape and q leave the pane", async () => {
    const { commands } = await opened();

    press("Escape");
    expect(commands.closeNote).toHaveBeenCalledTimes(1);
    press("q");
    expect(commands.closeNote).toHaveBeenCalledTimes(2);
  });

  it("#425 A4 ctrl+enter restores the picked change over the text the diff was drawn against", async () => {
    const { onRestore } = await opened();

    press("Enter", { ctrlKey: true });

    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(NEWEST, NOW, "kxyzkxyz"));
  });

  it("#425 A4 the Restore button restores the picked change", async () => {
    const { onRestore } = await opened();
    fireEvent.click(rows()[1] as HTMLElement);
    await waitFor(() => expect(diff()).toContain("-id: 1"));

    const button = screen.getByRole("button", { name: "Restore" });
    expect(button).toHaveClass("pointer-coarse:min-h-11");
    fireEvent.click(button);

    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(OLDEST, NOW, "lmnolmno"));
  });

  it("#425 A3 A4 keeps the picked change when a new one lands on top", async () => {
    const { onRestore, client } = await opened();
    fireEvent.click(rows()[1] as HTMLElement);
    await waitFor(() => expect(diff()).toContain("-id: 1"));

    fetchHistory.mockResolvedValue({
      versioned: true,
      changes: [
        {
          commit: "d".repeat(40),
          change: "pqrspqrs",
          time: "2026-10-17T10:00:00+02:00",
          description: "a write elsewhere",
          path: NOTE,
        },
        ...CHANGES,
      ],
    });
    await client.invalidateQueries({ queryKey: ["note", NOTE, "history"] });
    await waitFor(() => expect(rows()).toHaveLength(3));

    expect(rows()[2]).toHaveAttribute("aria-current", "true");
    expect(rows()[2]).toHaveAttribute("aria-selected", "true");
    press("Enter", { ctrlKey: true });
    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(OLDEST, NOW, "lmnolmno"));
  });

  it("#425 A5 says why a restore was refused", async () => {
    await opened(vi.fn(async () => "The note changed since this diff was drawn"));

    press("Enter", { ctrlKey: true });

    await waitFor(() => expect(said()).toBe("The note changed since this diff was drawn"));
  });

  it("#425 I7 a change that is the note now cannot be restored, and says so", async () => {
    // The vault's text again, under another stamp: nothing a restore would change.
    fetchNote.mockResolvedValue(NEWEST.replace("2026-10-16T09:30", "2026-10-17T11:00"));
    const onRestore = vi.fn(async () => null);
    open(onRestore);
    await waitFor(() => expect(said()).toBe("This change is the note as it is now"));

    expect(screen.getByRole("button", { name: "Restore" })).toBeDisabled();
    press("Enter", { ctrlKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("#425 I4 says the vault keeps no history when it is not versioned", async () => {
    fetchHistory.mockResolvedValue({ versioned: false, changes: [] });
    open();

    expect(await within(pane()).findByText("This vault keeps no history")).toBeInTheDocument();
  });

  it("#425 I4 says the note has no history yet when the list is empty", async () => {
    fetchHistory.mockResolvedValue({ versioned: true, changes: [] });
    open();

    expect(await within(pane()).findByText("This note has no history yet")).toBeInTheDocument();
  });

  it("#425 I4 says the history could not be read when the vault fails", async () => {
    fetchHistory.mockRejectedValue(new Error("GET /api/history failed with 503"));
    open();

    expect(await within(pane()).findByText("The history could not be read")).toBeInTheDocument();
  });
});
