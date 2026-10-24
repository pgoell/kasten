import { fireEvent, screen, waitFor } from "@testing-library/react";
import { shownCard } from "./review-card";
import { MEDIA, renderDeck } from "./review-session-fixture";

describe("ReviewSession on a card with pictures", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("draws a picture on both sides of the card", async () => {
    renderDeck(`#flashcards/aws\n\nLook ![](${MEDIA}/front.png)::Back ![](${MEDIA}/back.png)\n`);

    const card = await shownCard();
    await waitFor(() =>
      expect(card.querySelector("img.cm-image")?.getAttribute("src")).toBe(
        `/api/assets/${MEDIA}/front.png`,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Show the answer" }));

    await waitFor(() =>
      expect(
        screen.getByTestId("review-back").querySelector("img.cm-image")?.getAttribute("src"),
      ).toBe(`/api/assets/${MEDIA}/back.png`),
    );
  });
});

describe("ReviewSession playing a card's sounds", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  /** jsdom builds a media element and plays nothing, so the player is stubbed. */
  function stubPlayer() {
    // The source read when `play` is called: the session reuses one element,
    // so reading it off the calls afterwards would answer the last one each time.
    const sources: string[] = [];
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      sources.push(this.src);
      return Promise.resolve();
    });
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockReturnValue(undefined);
    const played = () => [...sources];
    return { play, pause, played };
  }

  it("plays an audio-only front when the card shows", async () => {
    const { played } = stubPlayer();
    renderDeck(`#flashcards/aws\n\n![](${MEDIA}/kana.mp3)::か\n`);

    await waitFor(() => expect(played()).toHaveLength(1));
    expect(played()[0]).toMatch(/\/api\/assets\/Flashcards\/Japanese%20media\/kana\.mp3$/);
  });

  it("plays the back's sound on reveal", async () => {
    const { play, played } = stubPlayer();
    renderDeck(`#flashcards/aws\n\n![](${MEDIA}/kana.mp3)::か ![](${MEDIA}/ka.mp3)\n`);
    await waitFor(() => expect(play).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: "Show the answer" }));

    expect(played()).toHaveLength(2);
    expect(played()[1]).toMatch(/\/ka\.mp3$/);
  });

  it("stops the front's sound on reveal when the back has none", async () => {
    const { play, pause } = stubPlayer();
    renderDeck(`#flashcards/aws\n\n![](${MEDIA}/kana.mp3)::か\n`);
    await waitFor(() => expect(play).toHaveBeenCalledOnce());
    pause.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Show the answer" }));

    expect(pause).toHaveBeenCalled();
    expect(play).toHaveBeenCalledOnce();
  });

  // Asserted straight after the tap and never waited for: a phone lets a sound
  // start only inside the tap that asked for it, so a play from an effect after
  // the render would be refused there.
  it("plays the next card's front from inside the rating", async () => {
    const { play, played } = stubPlayer();
    renderDeck(`#flashcards/aws\n\n![](${MEDIA}/a.mp3)::あ\n\n![](${MEDIA}/i.mp3)::い\n`);
    await waitFor(() => expect(play).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Show the answer" }));

    fireEvent.click(screen.getByRole("button", { name: "Good" }));

    expect(played().at(-1)).toMatch(/\/i\.mp3$/);
  });

  it("plays the next card's front from inside a suspend", async () => {
    const { play, played } = stubPlayer();
    renderDeck(`#flashcards/aws\n\n![](${MEDIA}/a.mp3)::あ\n\n![](${MEDIA}/i.mp3)::い\n`);
    await waitFor(() => expect(play).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: "Park this card" }));

    expect(played().at(-1)).toMatch(/\/i\.mp3$/);
  });

  it("plays the sounds of one side one after the other", async () => {
    const { play, played } = stubPlayer();
    renderDeck(`#flashcards/aws\n\n![](${MEDIA}/one.mp3) ![](${MEDIA}/two.mp3)::x\n`);
    await waitFor(() => expect(play).toHaveBeenCalledOnce());
    expect(played()[0]).toMatch(/\/one\.mp3$/);

    const player = play.mock.contexts[0] as HTMLMediaElement;
    fireEvent(player, new Event("ended"));

    expect(played()).toHaveLength(2);
    expect(played()[1]).toMatch(/\/two\.mp3$/);

    // The last one ending is the end of the side, not a reason to start over.
    fireEvent(player, new Event("ended"));
    expect(played()).toHaveLength(2);
  });

  it("moves on to the next sound when one cannot play", async () => {
    const { play, played } = stubPlayer();
    // A file deleted from the vault: the play is refused as unsupported.
    play.mockRejectedValueOnce(new DOMException("gone", "NotSupportedError"));
    renderDeck(`#flashcards/aws\n\n![](${MEDIA}/missing.mp3) ![](${MEDIA}/two.mp3)::x\n`);

    await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    expect(played()).toHaveLength(1);
    expect(played()[0]).toMatch(/\/two\.mp3$/);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("moves on to the next sound when the player reports an error", async () => {
    const { play, played } = stubPlayer();
    renderDeck(`#flashcards/aws\n\n![](${MEDIA}/missing.mp3) ![](${MEDIA}/two.mp3)::x\n`);
    await waitFor(() => expect(play).toHaveBeenCalledOnce());

    fireEvent(play.mock.contexts[0] as HTMLMediaElement, new Event("error"));

    expect(played()).toHaveLength(2);
    expect(played()[1]).toMatch(/\/two\.mp3$/);
  });

  it("stops the sound when the card is rated and the next has none", async () => {
    const { play, pause } = stubPlayer();
    renderDeck(`#flashcards/aws\n\n![](${MEDIA}/a.mp3)::あ\n\nquiet::silent\n`);
    await waitFor(() => expect(play).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Show the answer" }));
    pause.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Good" }));

    expect(pause).toHaveBeenCalled();
    expect(play).toHaveBeenCalledOnce();
  });

  it("stops the sound when the sitting is left", async () => {
    const { play, pause } = stubPlayer();
    const { unmount } = renderDeck(`#flashcards/aws\n\n![](${MEDIA}/a.mp3)::あ\n`);
    await waitFor(() => expect(play).toHaveBeenCalledOnce());
    pause.mockClear();

    unmount();

    expect(pause).toHaveBeenCalled();
  });

  it("replays the side showing on a tap", async () => {
    const { play, played } = stubPlayer();
    renderDeck(`#flashcards/aws\n\n![](${MEDIA}/kana.mp3)::か ![](${MEDIA}/ka.mp3)\n`);
    await waitFor(() => expect(play).toHaveBeenCalledOnce());

    const replay = screen.getByRole("button", { name: "Replay" });
    expect(replay).toHaveClass("min-h-11", "pointer-coarse:min-w-11");
    fireEvent.click(replay);
    expect(played()).toHaveLength(2);
    expect(played()[1]).toMatch(/\/kana\.mp3$/);

    fireEvent.click(screen.getByRole("button", { name: "Show the answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Replay" }));
    expect(played().at(-1)).toMatch(/\/ka\.mp3$/);
    expect(played().filter((src) => src.endsWith("/ka.mp3"))).toHaveLength(2);
  });

  it("draws Replay only on a side that has a sound", async () => {
    stubPlayer();
    renderDeck(`#flashcards/aws\n\nquiet::loud ![](${MEDIA}/ka.mp3)\n`);
    await shownCard();

    expect(screen.queryByRole("button", { name: "Replay" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show the answer" }));

    expect(screen.getByRole("button", { name: "Replay" })).toBeInTheDocument();
  });

  it("says nothing when the browser refuses to start a sound, and plays on the tap", async () => {
    const { play, played } = stubPlayer();
    play.mockRejectedValueOnce(new DOMException("no gesture", "NotAllowedError"));
    renderDeck(`#flashcards/aws\n\n![](${MEDIA}/kana.mp3)::か\n`);
    await waitFor(() => expect(play).toHaveBeenCalledOnce());

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Replay" }));

    // The refused call went past the recording stub, so the tap is the one held.
    expect(play).toHaveBeenCalledTimes(2);
    expect(played().at(-1)).toMatch(/\/kana\.mp3$/);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
