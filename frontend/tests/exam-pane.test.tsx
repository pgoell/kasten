import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ExamPane } from "@/components/exam-pane";
import { stubCommands } from "./stub-commands";

// Standing in for the module rather than for `fetch`, the way the todo pane's
// tests do: what the pane owns is what it asks the vault for.
const { fetchNote, createNote } = vi.hoisted(() => ({
  fetchNote: vi.fn(),
  createNote: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ fetchNote, createNote }));

const EXAM = `# Terraform drills

## Type conversion

### Q1

Which cast does Terraform refuse?

- A. string to number
- B. list to set

Correct: B

A set drops duplicates, so it does not go back.

### Q2 · select TWO

Which TWO are valid for_each collections?

- A. a list
- B. a set
- C. a map

Answer: B, C
`;

const NOTE = "drills/terraform.md";

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  fetchNote.mockReset();
  createNote.mockReset();
  fetchNote.mockResolvedValue(EXAM);
  createNote.mockImplementation((path: string, content: string) => ({ path, content }));
});

function open(commands = stubCommands(), onOpen = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ExamPane note={NOTE} commands={commands} onOpen={onOpen} focusSignal={1} />
    </QueryClientProvider>,
  );
  return { commands, onOpen };
}

/** The pane itself, which is where the keys are pressed. */
function pane(): HTMLElement {
  const found = document.querySelector("[data-exam-pane]");
  if (found === null) throw new Error("no exam pane");
  return found as HTMLElement;
}

function press(key: string) {
  fireEvent.keyDown(pane(), { key });
}

describe("ExamPane", () => {
  it("asks the first question of the note it was given", async () => {
    open();
    expect(await screen.findByText(/Which cast does Terraform refuse/)).toBeTruthy();
  });

  it("does not show the answer until it is asked for", async () => {
    open();
    await screen.findByText(/Which cast does Terraform refuse/);
    expect(screen.queryByTestId("exam-rationale")).toBeNull();
  });

  it("shows the answer and the rationale on r", async () => {
    open();
    await screen.findByText(/Which cast does Terraform refuse/);
    press("r");
    expect(screen.getByTestId("exam-rationale").textContent).toContain("Correct: B");
    expect(screen.getByTestId("exam-rationale").textContent).toContain("A set drops duplicates");
  });

  it("walks to the next question on l, and back on h", async () => {
    open();
    await screen.findByText(/Which cast does Terraform refuse/);
    press("l");
    expect(screen.getByText(/valid for_each collections/)).toBeTruthy();
    press("h");
    expect(screen.getByText(/Which cast does Terraform refuse/)).toBeTruthy();
  });

  it("hides a revealed answer again when the question changes", async () => {
    open();
    await screen.findByText(/Which cast does Terraform refuse/);
    press("r");
    press("l");
    expect(screen.queryByTestId("exam-rationale")).toBeNull();
  });

  it("picks an option by its letter", async () => {
    open();
    await screen.findByText(/Which cast does Terraform refuse/);
    press("b");
    expect(document.querySelectorAll("[data-picked]")).toHaveLength(1);
  });

  it("replaces the pick on a single-answer question rather than adding to it", async () => {
    open();
    await screen.findByText(/Which cast does Terraform refuse/);
    press("a");
    press("b");
    expect(document.querySelectorAll("[data-picked]")).toHaveLength(1);
  });

  it("holds two picks where the question asks for two", async () => {
    open();
    await screen.findByText(/Which cast does Terraform refuse/);
    press("l");
    press("b");
    press("c");
    expect(document.querySelectorAll("[data-picked]")).toHaveLength(2);
  });

  it("unpicks a letter pressed twice", async () => {
    open();
    await screen.findByText(/Which cast does Terraform refuse/);
    press("b");
    press("b");
    expect(document.querySelectorAll("[data-picked]")).toHaveLength(0);
  });

  it("ignores a letter no option carries", async () => {
    open();
    await screen.findByText(/Which cast does Terraform refuse/);
    press("j");
    expect(document.querySelectorAll("[data-picked]")).toHaveLength(0);
  });

  it("scores the sitting on g and writes it to a note beside the exam", async () => {
    open();
    await screen.findByText(/Which cast does Terraform refuse/);
    press("b");
    press("l");
    press("b");
    press("c");
    press("g");

    await waitFor(() => expect(createNote).toHaveBeenCalled());
    const [path, content] = createNote.mock.calls[0] ?? [];
    expect(path).toMatch(/^drills\/terraform results\/\d{4}-\d{2}-\d{2} \d{4}\.md$/);
    expect(content).toContain("2/2 (100%)");
    expect(content).toContain("[[drills/terraform]]");
  });

  it("shows the score once it has graded", async () => {
    open();
    await screen.findByText(/Which cast does Terraform refuse/);
    press("a");
    press("g");
    expect((await screen.findByTestId("exam-score")).textContent).toContain("0/2");
  });

  it("writes what was missed into the result note", async () => {
    open();
    await screen.findByText(/Which cast does Terraform refuse/);
    press("a");
    press("g");
    await waitFor(() => expect(createNote).toHaveBeenCalled());
    const content = createNote.mock.calls[0]?.[1] ?? "";
    expect(content).toContain("You answered A, correct is B.");
    expect(content).toContain("A set drops duplicates");
  });

  it("writes one note however many times g is pressed", async () => {
    open();
    await screen.findByText(/Which cast does Terraform refuse/);
    press("g");
    press("g");
    await waitFor(() => expect(createNote).toHaveBeenCalledTimes(1));
  });

  it("opens the result note on Enter once it has graded", async () => {
    const { onOpen } = open();
    await screen.findByText(/Which cast does Terraform refuse/);
    press("g");
    await screen.findByTestId("exam-score");
    press("Enter");
    expect(onOpen).toHaveBeenCalledWith(expect.stringContaining("drills/terraform results/"));
  });

  it("closes the pane on q", async () => {
    const { commands } = open();
    await screen.findByText(/Which cast does Terraform refuse/);
    press("q");
    expect(commands.closeNote).toHaveBeenCalled();
  });

  it("still reaches a leader key, so the panes can be walked mid-sitting", async () => {
    const { commands } = open();
    await screen.findByText(/Which cast does Terraform refuse/);
    press(" ");
    press("t");
    press("l");
    expect(commands.nextTab).toHaveBeenCalled();
  });

  it("keeps the sitting when the result note cannot be written", async () => {
    createNote.mockRejectedValue(new Error("409 taken"));
    open();
    await screen.findByText(/Which cast does Terraform refuse/);
    press("b");
    press("g");
    const score = await screen.findByTestId("exam-score");
    expect(score.textContent).toContain("1/2");
    expect((await screen.findByRole("alert")).textContent).toContain("409 taken");
  });

  it("sets a two hour timer on t, which is what the exams allow", async () => {
    open();
    await screen.findByText(/Which cast does Terraform refuse/);
    press("t");
    expect(screen.getByTestId("exam-timer").textContent).toBe("120:00");
  });

  it("takes the length from the digits typed before t", async () => {
    open();
    await screen.findByText(/Which cast does Terraform refuse/);
    press("9");
    press("0");
    press("t");
    expect(screen.getByTestId("exam-timer").textContent).toBe("90:00");
  });

  it("takes the timer away when t is pressed again", async () => {
    open();
    await screen.findByText(/Which cast does Terraform refuse/);
    press("t");
    press("t");
    expect(screen.queryByTestId("exam-timer")).toBeNull();
  });

  it("grades the sitting where it stands when the timer runs out", async () => {
    open();
    await screen.findByText(/Which cast does Terraform refuse/);
    press("b");

    // The fake clock is started before the timer, so the interval the pane sets
    // going is the fake one and the minute below actually passes for it.
    vi.useFakeTimers();
    press("1");
    press("t");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(screen.getByTestId("exam-timer").textContent).toBe("0:00");
    expect(screen.getByTestId("exam-score").textContent).toContain("1/2");
    expect(createNote).toHaveBeenCalledTimes(1);
  });

  it("says so, rather than showing an empty exam, when the note holds none", async () => {
    fetchNote.mockResolvedValue("# Just a note\n\nSome prose.\n");
    open();
    expect((await screen.findByRole("alert")).textContent).toContain("No exam in");
  });
});
