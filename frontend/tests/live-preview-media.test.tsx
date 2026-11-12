import { vim } from "@replit/codemirror-vim";
import { waitFor } from "@testing-library/react";
import { Editor } from "@/components/editor";
import { embedSource } from "@/lib/notes/embeds/embed";
import { imagePaths } from "@/lib/notes/embeds/image";
import { vaultPaths } from "@/lib/notes/links/wikilink";
import { livePreview } from "@/lib/notes/live/live-preview";
import {
  ABOVE,
  content,
  fakeVault,
  liveHooks,
  mount,
  plain,
  renderEditor,
} from "./live-preview-fixture";

liveHooks();

describe("live preview", () => {
  it("draws a note's youtube ![](link) as a player", () => {
    const { container } = renderEditor(
      <Editor initialDoc={"notes\n\n![](https://youtu.be/iDulhoQ2pro)\n"} />,
    );

    const frame = container.querySelector("iframe.cm-video-frame");
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
      expect(container.querySelector("iframe.cm-video-frame")?.getAttribute("src")).toContain(
        "start=312",
      ),
    );
  });

  it("leaves a picture a picture", () => {
    // `<>` around it, the way CommonMark writes an address with a space.
    const { container } = renderEditor(<Editor initialDoc={"![shot](<99 Misc/shot.png>)\n"} />);

    expect(container.querySelector("iframe.cm-video-frame")).toBeNull();
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

describe("a video file", () => {
  const PATHS = ["b.md", "clips/walk.mp4", "clips/RUN.WEBM"];
  const players = (view: { dom: HTMLElement }) => [...view.dom.querySelectorAll("video.cm-clip")];
  const expectPlayer = (video: Element | undefined, src: string) => {
    const player = video as HTMLVideoElement;
    expect(player.getAttribute("src")).toBe(src);
    expect(player.controls).toBe(true);
    // Never plays unasked, and reads only the head until played.
    expect(player.autoplay).toBe(false);
    expect(player.hasAttribute("autoplay")).toBe(false);
    expect(player.preload).toBe("metadata");
    expect(player.playsInline).toBe(true);
  };

  it("draws ![[walk.mp4]] and ![[run.webm]] as players, with vim on and off", () => {
    for (const vimOn of [false, true]) {
      const source = fakeVault({}).source;
      const view = mount(
        `${ABOVE}![[walk.mp4]]\n\n![[run.webm]]\n`,
        vimOn
          ? [vim(), livePreview(), vaultPaths.of(PATHS), imagePaths.of([]), embedSource.of(source)]
          : plain(source, PATHS),
      );

      const [mp4, webm] = players(view);
      expectPlayer(mp4, "/api/assets/clips/walk.mp4");
      expectPlayer(webm, "/api/assets/clips/RUN.WEBM");
      expect(view.dom.querySelector("img.cm-image")).toBeNull();
      expect(view.contentDOM.textContent).not.toContain("![[");
    }
  });

  it("draws ![](path) to a video file as the same player", () => {
    const view = mount(
      `${ABOVE}![](clips/walk.mp4)\n\n![](<clips/Swim%20%231.WEBM?t=2>)\n`,
      plain(fakeVault({}).source, PATHS),
    );

    expectPlayer(players(view)[0], "/api/assets/clips/walk.mp4");
    expect(players(view)[1]?.getAttribute("src")).toContain("Swim");
    expect(view.dom.querySelector("img.cm-image")).toBeNull();
  });

  it("says Not found for a video file the vault does not hold", () => {
    const view = mount(`${ABOVE}![[gone.mp4]]\n`, plain(fakeVault({}).source, PATHS));

    expect(players(view)).toHaveLength(0);
    expect(view.dom.querySelector(".cm-embed-missing")?.textContent).toBe("Not found: gone.mp4");
  });

  it("keeps the same player through a keystroke elsewhere, so a playing video goes on", () => {
    const view = mount(`${ABOVE}![[walk.mp4]]\n`, plain(fakeVault({}).source, PATHS));
    const [before] = players(view);
    expect(before).toBeInstanceOf(HTMLVideoElement);

    view.dispatch({ changes: { from: 0, insert: "more " } });

    expect(players(view)[0]).toBe(before);
  });
});
