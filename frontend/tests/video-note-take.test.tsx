import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useBookNoteTake } from "@/components/use-book-note-take";
import { addHighlight, type Passage } from "@/lib/highlight";
import { VIDEO_REFUSED } from "@/lib/page-undo";

const { fetchNote, saveNote, updateNote, searchNotes } = vi.hoisted(() => ({
  fetchNote: vi.fn(),
  saveNote: vi.fn(),
  updateNote: vi.fn(),
  searchNotes: vi.fn(),
}));
vi.mock("@/lib/api", () => {
  class ChangedOnDisk extends Error {}
  return { fetchNote, saveNote, updateNote, searchNotes, ChangedOnDisk };
});

const NOTE = "20 Videos/Lecture.md";
const ID = "hl-a3f9c1";
const BASE = "# Lecture\n\n## Highlights\n";
const PASSAGE: Passage = {
  text: "A passage of the video.",
  chapter: "",
  link: "[12:34](https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=754s)",
};
const WRITTEN = addHighlight(BASE, PASSAGE, ID);

/** The hook's answer for the test's component, read at the moment it is needed. */
let video: ReturnType<typeof useBookNoteTake> | null = null;

function Taker({ onTake }: { onTake: () => Promise<string | null> }) {
  const hook = useBookNoteTake({
    note: NOTE,
    archive: false,
    onTake,
    title: "Taken into the video's note",
    refused: VIDEO_REFUSED,
  });
  video = hook;
  return <div>{hook.toast}</div>;
}

function renderTaker(onTake: () => Promise<string | null>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<Taker onTake={onTake} />, { wrapper });
}

afterEach(() => {
  cleanup();
  video = null;
  vi.resetAllMocks();
});

beforeEach(() => {
  fetchNote.mockResolvedValue(WRITTEN);
  saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
  searchNotes.mockResolvedValue([]);
  updateNote.mockResolvedValue(null);
});

describe("the video's note take", () => {
  it("#791 A8 a video take shows the video's title on the toast, and Undo refuses with the video's words when the note changed", async () => {
    fetchNote.mockResolvedValueOnce(WRITTEN).mockResolvedValue(`${WRITTEN}\nWritten meanwhile.\n`);
    renderTaker(async () => ID);

    act(() => void video?.take(PASSAGE, false));
    await screen.findByText("Taken into the video's note");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    await screen.findByText(VIDEO_REFUSED);
    expect(saveNote).not.toHaveBeenCalled();
  });
});
