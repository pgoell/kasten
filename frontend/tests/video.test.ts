import { noteVideos, playerUrl, setWatched, watchedAt } from "@/lib/video";

const ONE = "dQw4w9WgXcQ";
const TWO = "iDulhoQ2pro";

describe("the videos a note links", () => {
  it.each([
    ["a watch URL", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["the short host", "https://youtu.be/dQw4w9WgXcQ"],
    ["an embed", "https://www.youtube.com/embed/dQw4w9WgXcQ"],
    ["a short", "https://www.youtube.com/shorts/dQw4w9WgXcQ"],
    ["a livestream", "https://www.youtube.com/live/dQw4w9WgXcQ"],
    ["mobile", "https://m.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["a watch URL behind a playlist", "https://www.youtube.com/watch?list=PL123&v=dQw4w9WgXcQ"],
    ["a timestamped link", "https://youtu.be/dQw4w9WgXcQ?t=90"],
  ])("reads the id out of %s", (_shape, url) => {
    expect(noteVideos(`notes about it\n\n[the talk](${url})\n`)).toEqual([ONE]);
  });

  it("keeps them in the note's order, which is what stepping follows", () => {
    const text = `[two](https://youtu.be/${TWO})\n[one](https://youtu.be/${ONE})`;
    expect(noteVideos(text)).toEqual([TWO, ONE]);
  });

  it("counts a video linked twice once, so stepping cannot land on it twice", () => {
    const text = `top: https://youtu.be/${ONE}\n\nand again https://www.youtube.com/watch?v=${ONE}`;
    expect(noteVideos(text)).toEqual([ONE]);
  });

  it("finds nothing in a note that links no video", () => {
    expect(noteVideos("# A note\n\n[a page](https://example.com/watch?v=x)\n")).toEqual([]);
  });

  it("refuses a host that merely ends in the right letters", () => {
    expect(noteVideos("https://notyoutube.com/watch?v=dQw4w9WgXcQ")).toEqual([]);
  });
});

describe("the player URL", () => {
  it("turns the JS API on, which is what lets the note pause the player", () => {
    expect(playerUrl(ONE)).toBe(`https://www.youtube.com/embed/${ONE}?enablejsapi=1`);
  });

  it("opens at the second it is given", () => {
    expect(playerUrl(ONE, 312)).toBe(
      `https://www.youtube.com/embed/${ONE}?enablejsapi=1&start=312`,
    );
  });

  it("carries no position for a video nobody has watched", () => {
    expect(playerUrl(ONE, 0)).not.toContain("start");
  });

  it("rounds down, the parameter taking whole seconds", () => {
    expect(playerUrl(ONE, 312.9)).toContain("start=312");
  });
});

describe("the position a note remembers", () => {
  const NOTE = "---\ntitle: A course\n---\n\nNotes.\n";

  it("is nothing at all for a note that has never held one", () => {
    expect(watchedAt(NOTE, ONE)).toBe(0);
  });

  it("comes back out the way it went in", () => {
    expect(watchedAt(setWatched(NOTE, ONE, 312), ONE)).toBe(312);
  });

  it("keeps one video's position when another is written", () => {
    const both = setWatched(setWatched(NOTE, ONE, 312), TWO, 45);

    expect(watchedAt(both, ONE)).toBe(312);
    expect(watchedAt(both, TWO)).toBe(45);
    expect(both).toContain(`watching: {${ONE}: 312, ${TWO}: 45}`);
  });

  it("replaces a video's own position rather than adding a second entry", () => {
    const moved = setWatched(setWatched(NOTE, ONE, 312), ONE, 400);

    expect(watchedAt(moved, ONE)).toBe(400);
    expect(moved).toContain(`watching: {${ONE}: 400}`);
  });

  it("drops a video wound back to the start rather than storing a zero", () => {
    const cleared = setWatched(setWatched(NOTE, ONE, 312), ONE, 0);

    expect(watchedAt(cleared, ONE)).toBe(0);
    expect(cleared).toContain("watching: {}");
  });

  it("rounds down, a bookmark not needing a fraction of a second", () => {
    expect(watchedAt(setWatched(NOTE, ONE, 312.7), ONE)).toBe(312);
  });
});
