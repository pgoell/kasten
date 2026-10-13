import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TriagePane } from "@/components/triage-pane";
import * as api from "@/lib/api";
import * as chat from "@/lib/chat";
import { stubCommands } from "./stub-commands";

/** Three notes in the inbox, one note already filed, and one in the archive. */
const FILES = [
  "00 Inbox/a.md",
  "00 Inbox/b.md",
  "00 Inbox/c.md",
  "00 Inbox/index.md",
  "03 Areas/x.md",
  "98 Archive/old.md",
];

const NO_FOLDER =
  "The proposal was no folder to move to. Press r to ask again, or e to type a place.";

/** What the agent answers for each note it is asked about. An Error is a failed call. */
const answers = new Map<string, chat.Proposal | Error>();

/** Every note the agent has been asked about, once per call. */
function asked(): string[] {
  return vi.mocked(chat.proposeFolder).mock.calls.map(([input]) => input.path);
}

/** The vault's listing. A move that lands changes it, so the refetch after a move agrees with the move. */
let vault: string[] = [];

function moveInVault(from: string, to: string) {
  vault = vault.map((file) => (file === from ? to : file));
}

/** A rename that lands at once, the way the vault answers one. */
function landRename() {
  return vi.spyOn(api, "renameNote").mockImplementation(async (from, to) => {
    moveInVault(from, to);
    return { path: to, content: "text" };
  });
}

/** A rename the test lands by hand with `land`, for a move that has to be seen in flight. */
function holdRename() {
  const held: { land?: () => void } = {};
  const rename = vi.spyOn(api, "renameNote").mockImplementation(
    (from, to) =>
      new Promise<api.Note>((resolve) => {
        held.land = () => {
          moveInVault(from, to);
          resolve({ path: to, content: "text" });
        };
      }),
  );
  return { rename, land: () => held.land?.() };
}

function renderPane() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const commands = stubCommands();
  const onClose = vi.fn();
  const onOpen = vi.fn();
  const onMoved = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <TriagePane commands={commands} onClose={onClose} onOpen={onOpen} onMoved={onMoved} />
    </QueryClientProvider>,
  );
  return { client, commands, onClose, onOpen, onMoved, pane: screen.getByLabelText("triage") };
}

describe("TriagePane", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    answers.clear();
    vault = [...FILES];
    vi.spyOn(api, "fetchFiles").mockImplementation(async () => [...vault]);
    vi.spyOn(api, "fetchNote").mockImplementation(async (path: string) => `text of ${path}`);
    vi.spyOn(chat, "proposeFolder").mockImplementation(async (input) => {
      const answer = answers.get(input.path) ?? { folder: "03 Areas", reason: "about areas" };
      if (answer instanceof Error) throw answer;
      return answer;
    });
  });

  it("shows the first inbox note, its text and the proposed target", async () => {
    renderPane();

    expect(await screen.findByText("text of 00 Inbox/a.md")).toBeInTheDocument();
    expect(screen.getByText("1 of 3")).toBeInTheDocument();
    expect(await screen.findByText("03 Areas/a.md")).toBeInTheDocument();
    expect(screen.getByText("about areas")).toBeInTheDocument();
  });

  it("moves the note on Enter, reports it, shows the next one and keeps the focus on the pane", async () => {
    const rename = landRename();
    const { pane, onMoved } = renderPane();
    await screen.findByText("03 Areas/a.md");

    fireEvent.keyDown(pane, { key: "Enter" });

    expect(rename).toHaveBeenCalledWith("00 Inbox/a.md", "03 Areas/a.md");
    expect(await screen.findByText("00 Inbox/b.md")).toBeInTheDocument();
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    expect(onMoved).toHaveBeenCalledWith("00 Inbox/a.md", "03 Areas/a.md");
    expect(document.activeElement).toBe(pane);
  });

  it("walks the notes with j and k without wrapping", async () => {
    const { pane } = renderPane();
    await screen.findByText("03 Areas/a.md");

    fireEvent.keyDown(pane, { key: "j" });
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
    fireEvent.keyDown(pane, { key: "j" });
    expect(screen.getByText("3 of 3")).toBeInTheDocument();
    fireEvent.keyDown(pane, { key: "j" });
    expect(screen.getByText("3 of 3")).toBeInTheDocument();

    fireEvent.keyDown(pane, { key: "k" });
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
    fireEvent.keyDown(pane, { key: "k" });
    fireEvent.keyDown(pane, { key: "k" });
    expect(screen.getByText("1 of 3")).toBeInTheDocument();
  });

  it("asks for the current note and the next one at rest, and nothing new on j or k", async () => {
    const { pane } = renderPane();
    await screen.findByText("03 Areas/a.md");
    await waitFor(() => expect(asked()).toHaveLength(2));
    expect(asked()).toEqual(expect.arrayContaining(["00 Inbox/a.md", "00 Inbox/b.md"]));

    fireEvent.keyDown(pane, { key: "j" });
    await waitFor(() => expect(asked()).toHaveLength(3));
    expect(asked()).toContain("00 Inbox/c.md");

    fireEvent.keyDown(pane, { key: "k" });
    await screen.findByText("1 of 3");
    expect(asked()).toHaveLength(3);
  });

  it("asks only for the note newly reached after a move", async () => {
    landRename();
    const { pane } = renderPane();
    await screen.findByText("03 Areas/a.md");
    await waitFor(() => expect(asked()).toHaveLength(2));

    fireEvent.keyDown(pane, { key: "Enter" });
    await screen.findByText("00 Inbox/b.md");

    await waitFor(() => expect(asked()).toHaveLength(3));
    expect(asked()).toContain("00 Inbox/c.md");
  });

  it("asks nothing new when the listing is invalidated", async () => {
    const { client } = renderPane();
    await screen.findByText("03 Areas/a.md");
    await waitFor(() => expect(asked()).toHaveLength(2));

    await client.invalidateQueries({ queryKey: ["files"] });

    expect(api.fetchFiles).toHaveBeenCalledTimes(2);
    expect(asked()).toHaveLength(2);
  });

  it("moves to the typed path on Enter in the field", async () => {
    const rename = vi
      .spyOn(api, "renameNote")
      .mockResolvedValue({ path: "04 Notes/a.md", content: "text" });
    const { pane } = renderPane();
    await screen.findByText("03 Areas/a.md");

    fireEvent.keyDown(pane, { key: "e" });
    const field = screen.getByLabelText("move to");
    expect(field).toHaveValue("03 Areas/a.md");
    fireEvent.change(field, { target: { value: "04 Notes/a.md" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(rename).toHaveBeenCalledWith("00 Inbox/a.md", "04 Notes/a.md");
  });

  it("cancels the field on Escape without moving", async () => {
    const rename = vi.spyOn(api, "renameNote");
    const { pane } = renderPane();
    await screen.findByText("03 Areas/a.md");

    fireEvent.keyDown(pane, { key: "e" });
    fireEvent.keyDown(screen.getByLabelText("move to"), { key: "Escape" });

    expect(screen.queryByLabelText("move to")).not.toBeInTheDocument();
    expect(rename).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(pane);
  });

  it("shows the move error and keeps the note on screen", async () => {
    vi.spyOn(api, "renameNote").mockRejectedValue(new Error("PATCH /api/files/x failed with 409"));
    const { pane } = renderPane();
    await screen.findByText("03 Areas/a.md");

    fireEvent.keyDown(pane, { key: "Enter" });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not move to 03 Areas/a.md. Something may already be there.",
    );
    expect(screen.queryByText(/409/)).not.toBeInTheDocument();
    expect(screen.getByText("text of 00 Inbox/a.md")).toBeInTheDocument();
  });

  it("keeps the focus in the field after a failed move typed into it", async () => {
    vi.spyOn(api, "renameNote").mockRejectedValue(new Error("PATCH /api/files/x failed with 409"));
    const { pane } = renderPane();
    await screen.findByText("03 Areas/a.md");

    fireEvent.keyDown(pane, { key: "e" });
    const field = screen.getByLabelText("move to");
    fireEvent.change(field, { target: { value: "04 Notes/a.md" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not move to 04 Notes/a.md.");
    expect(screen.getByLabelText("move to")).toBe(field);
    expect(field).toHaveFocus();
  });

  it("calls renameNote once when Enter is pressed twice quickly", async () => {
    const { rename, land } = holdRename();
    const { pane } = renderPane();
    await screen.findByText("03 Areas/a.md");

    fireEvent.keyDown(pane, { key: "Enter" });
    fireEvent.keyDown(pane, { key: "Enter" });

    expect(rename).toHaveBeenCalledTimes(1);
    land();
    expect(await screen.findByText("00 Inbox/b.md")).toBeInTheDocument();
  });

  it("does not move on Enter pressed on a focused button, which the button handles itself", async () => {
    const rename = landRename();
    renderPane();
    await screen.findByText("03 Areas/a.md");
    const move = screen.getByRole("button", { name: "Move (Enter)" });

    fireEvent.keyDown(move, { key: "Enter" });
    expect(rename).not.toHaveBeenCalled();

    // The browser turns Enter on a button into a click, which is the one move.
    fireEvent.click(move);
    expect(rename).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("00 Inbox/b.md")).toBeInTheDocument();
  });

  it("leaves keys typed in the field to the field", async () => {
    const { pane, commands, onClose } = renderPane();
    await screen.findByText("03 Areas/a.md");

    fireEvent.keyDown(pane, { key: "e" });
    const field = screen.getByLabelText("move to");
    for (const key of ["q", "j", " ", "g", "i"]) fireEvent.keyDown(field, { key });

    expect(field).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("1 of 3")).toBeInTheDocument();
    expect(commands.openTriage).not.toHaveBeenCalled();
  });

  it("does not skip the note after the moved one when j is pressed during a move", async () => {
    const { rename, land } = holdRename();
    const { pane } = renderPane();
    await screen.findByText("03 Areas/a.md");

    fireEvent.keyDown(pane, { key: "Enter" });
    fireEvent.keyDown(pane, { key: "j" });
    expect(screen.getByText("2 of 3")).toBeInTheDocument();

    land();
    await waitFor(() => expect(screen.getByText("1 of 2")).toBeInTheDocument());
    expect(rename).toHaveBeenCalledTimes(1);
    expect(screen.getByText("00 Inbox/b.md")).toBeInTheDocument();
  });

  it("keeps the note on screen when a refetch lists one in front of it", async () => {
    const { client, pane } = renderPane();
    await screen.findByText("03 Areas/a.md");
    fireEvent.keyDown(pane, { key: "j" });
    await screen.findByText("2 of 3");

    vi.mocked(api.fetchFiles).mockResolvedValue(["00 Inbox/0.md", ...FILES]);
    await client.invalidateQueries({ queryKey: ["files"] });

    expect(await screen.findByText("3 of 4")).toBeInTheDocument();
    expect(screen.getByText("00 Inbox/b.md")).toBeInTheDocument();
  });

  it("offers no move to a folder that has left the listing after the answer came", async () => {
    answers.set("00 Inbox/a.md", { folder: "03 Areas", reason: "a guess" });
    const rename = vi.spyOn(api, "renameNote");
    const { client, pane } = renderPane();
    await screen.findByText("03 Areas/a.md");

    vault = [...vault.filter((file) => !file.startsWith("03 Areas/")), "04 Notes/y.md"];
    await client.invalidateQueries({ queryKey: ["files"] });

    expect(await screen.findByText(NO_FOLDER)).toBeInTheDocument();
    fireEvent.keyDown(pane, { key: "Enter" });

    expect(rename).not.toHaveBeenCalled();
  });

  it("says there is no folder to file into and asks the agent nothing", async () => {
    vi.spyOn(api, "fetchFiles").mockResolvedValue(["00 Inbox/a.md", "98 Archive/old.md"]);
    renderPane();

    expect(await screen.findByText("text of 00 Inbox/a.md")).toBeInTheDocument();
    expect(
      screen.getByText("No folder to file into. Press e to type a place."),
    ).toBeInTheDocument();
    expect(chat.proposeFolder).not.toHaveBeenCalled();
  });

  it("shows a failed proposal, and r asks again", async () => {
    answers.set("00 Inbox/a.md", new Error("the runner is down"));
    const { pane } = renderPane();

    expect(await screen.findByText(/the runner is down/)).toBeInTheDocument();
    answers.delete("00 Inbox/a.md");
    fireEvent.keyDown(pane, { key: "r" });

    expect(await screen.findByText("03 Areas/a.md")).toBeInTheDocument();
  });

  it("aborts the proposal of a note the cursor walks past, and asks again on the way back", async () => {
    const signals = new Map<string, AbortSignal | undefined>();
    vi.mocked(chat.proposeFolder).mockImplementation((input, signal) => {
      signals.set(input.path, signal);
      return new Promise(() => {});
    });
    const { pane } = renderPane();
    await waitFor(() => expect(asked()).toHaveLength(2));
    const first = signals.get("00 Inbox/a.md");
    expect(first?.aborted).toBe(false);

    fireEvent.keyDown(pane, { key: "j" });
    fireEvent.keyDown(pane, { key: "j" });
    await waitFor(() => expect(first?.aborted).toBe(true));

    fireEvent.keyDown(pane, { key: "k" });
    fireEvent.keyDown(pane, { key: "k" });
    await screen.findByText("1 of 3");
    await waitFor(() => expect(asked().filter((path) => path === "00 Inbox/a.md")).toHaveLength(2));
  });

  it("does not ask again while a proposal is in flight", async () => {
    vi.mocked(chat.proposeFolder).mockImplementation(() => new Promise(() => {}));
    const { pane } = renderPane();
    await screen.findByText("Asking where this belongs");
    await waitFor(() => expect(asked()).toHaveLength(2));

    fireEvent.keyDown(pane, { key: "r" });

    expect(asked()).toHaveLength(2);
  });

  it("moves the note on Enter after a click on Next, which hands the focus back to the pane", async () => {
    const rename = landRename();
    const { pane } = renderPane();
    await screen.findByText("03 Areas/a.md");
    const next = screen.getByRole("button", { name: "Next (j)" });

    next.focus();
    fireEvent.click(next);
    await screen.findByText("03 Areas/b.md");
    expect(document.activeElement).toBe(pane);

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Enter" });
    expect(rename).toHaveBeenCalledWith("00 Inbox/b.md", "03 Areas/b.md");
  });

  it("steps back with k once Next has disabled itself at the last note", async () => {
    const { pane } = renderPane();
    await screen.findByText("03 Areas/a.md");
    const next = screen.getByRole("button", { name: "Next (j)" });

    next.focus();
    fireEvent.click(next);
    fireEvent.click(next);
    expect(screen.getByText("3 of 3")).toBeInTheDocument();
    expect(next).toBeDisabled();

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "k" });
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
    expect(pane).toHaveFocus();
  });

  it("steps with the Next and Previous buttons, and cancels the field with Cancel", async () => {
    const { pane } = renderPane();
    await screen.findByText("03 Areas/a.md");
    const previous = screen.getByRole("button", { name: "Previous (k)" });
    const next = screen.getByRole("button", { name: "Next (j)" });
    expect(previous).toBeDisabled();

    fireEvent.click(next);
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
    fireEvent.click(next);
    expect(screen.getByText("3 of 3")).toBeInTheDocument();
    expect(next).toBeDisabled();

    fireEvent.click(previous);
    fireEvent.click(previous);
    expect(screen.getByText("1 of 3")).toBeInTheDocument();
    expect(previous).toBeDisabled();

    fireEvent.keyDown(pane, { key: "e" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel (Esc)" }));
    expect(screen.queryByLabelText("move to")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(pane);
  });

  it("closes on a click on Close (q)", async () => {
    const { onClose } = renderPane();
    await screen.findByText("03 Areas/a.md");

    fireEvent.click(screen.getByRole("button", { name: "Close (q)" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on q and opens the note on o", async () => {
    const { pane, onClose, onOpen } = renderPane();
    await screen.findByText("03 Areas/a.md");

    fireEvent.keyDown(pane, { key: "o" });
    expect(onOpen).toHaveBeenCalledWith("00 Inbox/a.md");

    fireEvent.keyDown(pane, { key: "q" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("says the inbox is empty when no note waits in it", async () => {
    vi.spyOn(api, "fetchFiles").mockResolvedValue(["03 Areas/x.md"]);
    renderPane();

    expect(await screen.findByText("The inbox is empty.")).toBeInTheDocument();
  });

  it("opens the triage on space then g then i", async () => {
    const { commands, pane } = renderPane();
    await screen.findByText("03 Areas/a.md");

    fireEvent.keyDown(pane, { key: " " });
    fireEvent.keyDown(pane, { key: "g" });
    fireEvent.keyDown(pane, { key: "i" });

    expect(commands.openTriage).toHaveBeenCalledTimes(1);
  });
});
