import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { VideoPane } from "@/components/video-pane";
import { stubCommands } from "./stub-commands";

// Standing in for the module rather than for `fetch`, the way the exam pane's
// tests do: what the pane owns is what it asks the vault for.
const { fetchNote } = vi.hoisted(() => ({ fetchNote: vi.fn() }));
vi.mock("@/lib/api", () => ({ fetchNote }));

const NOTE = "lit/attention is all you need.md";
const TEXT = "# The talk\n\n[the recording](https://youtu.be/dQw4w9WgXcQ)\n\nNotes below.\n";

beforeEach(() => {
  fetchNote.mockReset();
  fetchNote.mockResolvedValue(TEXT);
});

function open(commands = stubCommands()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={client}>
      <VideoPane note={NOTE} commands={commands} focusSignal={1} />
    </QueryClientProvider>,
  );
  return { commands, pane: container.querySelector("[data-video-pane]") as HTMLElement };
}

describe("the video pane", () => {
  it("plays the video the note links, named after the note", async () => {
    open();

    const frame = await screen.findByTitle("video");
    expect(frame).toHaveAttribute("src", "https://www.youtube.com/embed/dQw4w9WgXcQ");
    expect(screen.getByText("attention is all you need")).toBeInTheDocument();
  });

  it("says so when the note links no video", async () => {
    fetchNote.mockResolvedValue("# A note\n\nNothing to watch here.\n");
    open();

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("No video linked"));
    expect(screen.queryByTitle("video")).toBeNull();
  });

  it("takes the focus when the pane is moved to, so the keys land here", () => {
    const { pane } = open();

    expect(document.activeElement).toBe(pane);
  });

  it("closes the pane on the leader then q", () => {
    const { commands, pane } = open();

    fireEvent.keyDown(pane, { key: " " });
    fireEvent.keyDown(pane, { key: "q" });

    expect(commands.closeNote).toHaveBeenCalled();
  });
});
