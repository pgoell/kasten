import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { VideoTakes } from "@/components/video-takes";
import { addHighlight } from "@/lib/highlight";

const ID = "dQw4w9WgXcQ";
const OTHER = "aaaaaaaaaaa";

/** A note with a take of this video at 12:34, and one of another video at 01:00, written as the take writes them. */
const NOTE = addHighlight(
  addHighlight(
    "# Talk\n",
    {
      text: "The first quote.",
      chapter: "",
      link: `[12:34](https://www.youtube.com/watch?v=${ID}&t=754s)`,
    },
    "hl-a1b2c3",
  ),
  {
    text: "Elsewhere quote.",
    chapter: "",
    link: `[01:00](https://www.youtube.com/watch?v=${OTHER}&t=60s)`,
  },
  "hl-d4e5f6",
);

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("the takes of this video", () => {
  it("#791 A5 the takes of this video list with their times and quotes and leave out another video's", () => {
    render(<VideoTakes text={NOTE} id={ID} onSeek={() => {}} />);

    expect({
      list: screen.getByRole("list", { name: "Taken from this video" }).querySelectorAll("li")
        .length,
      time: screen.getByRole("button", { name: "Seek to 12:34" }).textContent,
      quote: screen.queryByText("The first quote.") !== null,
      other: screen.queryByText("Elsewhere quote.") !== null,
    }).toEqual({ list: 1, time: "12:34", quote: true, other: false });
  });

  it("#791 A5 a take's time button calls onSeek with its seconds", () => {
    const onSeek = vi.fn();
    render(<VideoTakes text={NOTE} id={ID} onSeek={onSeek} />);

    fireEvent.click(screen.getByRole("button", { name: "Seek to 12:34" }));

    expect(onSeek.mock.calls).toEqual([[754]]);
  });
});
