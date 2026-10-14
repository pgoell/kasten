import { isAudio, soundsIn } from "@/lib/audio";

describe("isAudio", () => {
  it("knows the four suffixes an Anki deck carries, in any case", () => {
    for (const address of ["a.mp3", "a.ogg", "a.m4a", "a.wav", "A.MP3", "x/y.Wav"]) {
      expect(isAudio(address)).toBe(true);
    }
  });

  it("reads the path and not the query or an encoded name", () => {
    expect(isAudio("word.mp3?v=2")).toBe(true);
    expect(isAudio("word.mp3#t=1")).toBe(true);
    expect(isAudio("word%2Emp3")).toBe(true);
    expect(isAudio("shot.png")).toBe(false);
    expect(isAudio("mp3")).toBe(false);
  });

  it("does not throw on a malformed escape", () => {
    expect(isAudio("bad%E0.mp3")).toBe(true);
  });
});

describe("soundsIn", () => {
  it("answers the sounds of a card side in order, as URLs that play", () => {
    const side =
      "![](Flashcards/My%20Deck%20media/one.mp3) and ![x](Flashcards/My%20Deck%20media/x.png) " +
      "then ![](Flashcards/My%20Deck%20media/two.OGG)";

    expect(soundsIn(side)).toEqual([
      "/api/assets/Flashcards/My%20Deck%20media/one.mp3",
      "/api/assets/Flashcards/My%20Deck%20media/two.OGG",
    ]);
  });

  it("finds nothing on a side without a sound", () => {
    expect(soundsIn("What does S3 stand for?")).toEqual([]);
    expect(soundsIn("[a link](word.mp3)")).toEqual([]);
  });
});
