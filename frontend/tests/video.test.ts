import { noteVideo } from "@/lib/video";

describe("the video a note is about", () => {
  it.each([
    ["a watch URL", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["the short host", "https://youtu.be/dQw4w9WgXcQ"],
    ["an embed", "https://www.youtube.com/embed/dQw4w9WgXcQ?enablejsapi=1"],
    ["a short", "https://www.youtube.com/shorts/dQw4w9WgXcQ"],
    ["a livestream", "https://www.youtube.com/live/dQw4w9WgXcQ"],
    ["mobile", "https://m.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["a watch URL behind a playlist", "https://www.youtube.com/watch?list=PL123&v=dQw4w9WgXcQ"],
    ["a timestamped link", "https://youtu.be/dQw4w9WgXcQ?t=90"],
  ])("reads the id out of %s", (_shape, url) => {
    expect(noteVideo(`notes about it\n\n[the talk](${url})\n`)).toBe(
      "https://www.youtube.com/embed/dQw4w9WgXcQ?enablejsapi=1",
    );
  });

  it("takes the first of several, so a re-render cannot swap the player", () => {
    const text = "[one](https://youtu.be/aaaaaaaaaaa)\n[two](https://youtu.be/bbbbbbbbbbb)";
    expect(noteVideo(text)).toBe("https://www.youtube.com/embed/aaaaaaaaaaa?enablejsapi=1");
  });

  it("turns the JS API on, which is what lets the note pause the player", () => {
    expect(noteVideo("https://youtu.be/dQw4w9WgXcQ")).toContain("enablejsapi=1");
  });

  it("finds nothing in a note that links no video", () => {
    expect(noteVideo("# A note\n\n[a page](https://example.com/watch?v=x)\n")).toBeNull();
  });

  it("refuses a host that merely ends in the right letters", () => {
    expect(noteVideo("https://notyoutube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  });
});
