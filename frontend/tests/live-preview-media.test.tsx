import { waitFor } from "@testing-library/react";
import { Editor } from "@/components/editor";
import { content, liveHooks, renderEditor } from "./live-preview-fixture";

liveHooks();

describe("live preview", () => {
  it("draws a note's youtube ![](link) as a player", () => {
    const { container } = renderEditor(
      <Editor initialDoc={"notes\n\n![](https://youtu.be/iDulhoQ2pro)\n"} />,
    );

    const frame = container.querySelector("iframe.cm-video");
    expect(frame?.getAttribute("src")).toContain("/embed/iDulhoQ2pro");
    // The brackets and the address stand in for the frame, so neither is left
    // on the screen beside it.
    expect(content(container)).not.toContain("youtu.be");
  });

  it("opens the player where the note says the video got to", async () => {
    const { container } = renderEditor(
      <Editor
        initialDoc={"---\nwatching: {iDulhoQ2pro: 312}\n---\n\n![](https://youtu.be/iDulhoQ2pro)\n"}
      />,
    );

    // The first parse runs on a time budget, and under a loaded suite it can
    // stop short of the line under the frontmatter; the frame lands when the
    // parse catches up.
    await waitFor(() =>
      expect(container.querySelector("iframe.cm-video")?.getAttribute("src")).toContain(
        "start=312",
      ),
    );
  });

  it("leaves a picture a picture", () => {
    // `<>` around it, the way CommonMark writes an address with a space.
    const { container } = renderEditor(<Editor initialDoc={"![shot](<99 Misc/shot.png>)\n"} />);

    expect(container.querySelector("iframe.cm-video")).toBeNull();
    expect(container.querySelector("img.cm-image")?.getAttribute("alt")).toBe("shot");
    expect(container.querySelector("img.cm-image")?.getAttribute("src")).toBe(
      "/api/assets/99 Misc/shot.png",
    );
  });

  it("draws a sound's ![](path) as a player rather than a broken picture", () => {
    const { container } = renderEditor(
      <Editor initialDoc={"word\n\n![](Flashcards/Japanese%20media/kana.MP3)\n"} />,
    );

    const audio = container.querySelector("audio.cm-audio");
    expect(audio?.getAttribute("src")).toBe("/api/assets/Flashcards/Japanese%20media/kana.MP3");
    expect(audio?.hasAttribute("controls")).toBe(true);
    // A deck of a thousand cards would otherwise fetch a thousand sounds.
    expect(audio?.getAttribute("preload")).toBe("none");
    expect(container.querySelector("img.cm-image")).toBeNull();
    expect(content(container)).not.toContain("kana");
  });
});
