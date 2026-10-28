import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReviewDecks } from "@/components/review-decks";
import * as anki from "@/lib/anki-import";
import * as api from "@/lib/api";
import { HITS, renderPane, seededClient, serveNotes } from "./review-pane-fixture";

describe("ReviewDecks importing from a link", () => {
  const LINK = "https://ankiweb.net/shared/info/1104981491";
  const DONE = {
    notes: ["Anki/AWS.md"],
    cards: 120,
    media: 2,
    added: 5,
    updated: 3,
    kept: 110,
    removed: 2,
  };
  const SUMMARY =
    "1 deck, 120 cards: 5 added, 3 updated, 110 kept, 2 removed in Anki, 2 media files";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  async function renderDecks() {
    vi.spyOn(api, "fetchReviewLimits").mockResolvedValue({
      new_per_day: null,
      reviews_per_day: null,
    });
    vi.spyOn(api, "fetchCards").mockResolvedValue(HITS);
    serveNotes(HITS);
    const client = seededClient(HITS);
    render(
      <QueryClientProvider client={client}>
        <ReviewDecks onPick={vi.fn()} onParked={vi.fn()} />
      </QueryClientProvider>,
    );
    screen.getByRole("button", { name: /^alpha/ });
    const field = screen.getByLabelText("a link to an Anki deck") as HTMLInputElement;
    return { field, button: screen.getByRole("button", { name: "Import link" }) };
  }

  it("A1 imports the pasted link and shows the line a file import shows", async () => {
    const imported = vi.spyOn(anki, "importAnkiLink").mockResolvedValue(DONE);
    const { field, button } = await renderDecks();

    fireEvent.change(field, { target: { value: LINK } });
    fireEvent.click(button);

    expect(imported).toHaveBeenLastCalledWith(LINK, false);
    expect(await screen.findByText(SUMMARY)).toBeInTheDocument();
  });

  it("A2 carries Anki's schedule on a link import when ticked", async () => {
    const imported = vi.spyOn(anki, "importAnkiLink").mockResolvedValue(DONE);
    const { field, button } = await renderDecks();

    fireEvent.click(screen.getByRole("checkbox", { name: "Carry Anki's schedule" }));
    fireEvent.change(field, { target: { value: LINK } });
    fireEvent.click(button);

    expect(imported).toHaveBeenLastCalledWith(LINK, true);
    await screen.findByText(SUMMARY);
  });

  it("A10 imports on Enter in the field, the way a desk would", async () => {
    const imported = vi.spyOn(anki, "importAnkiLink").mockResolvedValue(DONE);
    const { field } = await renderDecks();

    fireEvent.change(field, { target: { value: LINK } });
    // jsdom does not submit a form on an Enter keypress, which a browser does
    // for a form holding a submit button, so the submit is sent as it would be.
    fireEvent.submit(field.form as HTMLFormElement);

    expect(imported).toHaveBeenLastCalledWith(LINK, false);
    await screen.findByText(SUMMARY);
  });

  it("A10 draws the field and button touch-sized in a row that wraps", async () => {
    const { field, button } = await renderDecks();

    expect(field).toHaveClass("min-h-11", "min-w-0", "flex-1");
    expect(button).toHaveClass("min-h-11");
    expect(field.type).toBe("url");
    expect(field.form?.parentElement).toHaveClass("flex-wrap");
  });

  it("I2 sends nothing for an empty or blank field", async () => {
    const imported = vi.spyOn(anki, "importAnkiLink").mockResolvedValue(DONE);
    const { field, button } = await renderDecks();

    fireEvent.click(button);
    fireEvent.change(field, { target: { value: "   " } });
    fireEvent.click(button);

    expect(imported).not.toHaveBeenCalled();
  });

  it("I2 sends a link that is not a URL to the backend and shows its message", async () => {
    const imported = vi
      .spyOn(anki, "importAnkiLink")
      .mockRejectedValue(new Error("Only https links"));
    const { field } = await renderDecks();
    const form = field.form as HTMLFormElement;

    // A browser checks a url field before it submits, and its own bubble would
    // stand in for the backend's sentence. jsdom does not run that check, so
    // the attribute that turns it off is what the test can see.
    expect(form.noValidate).toBe(true);
    fireEvent.change(field, { target: { value: "ankiweb.net/shared/info/1" } });
    fireEvent.submit(form);

    expect(imported).toHaveBeenLastCalledWith("ankiweb.net/shared/info/1", false);
    expect(await screen.findByText("Only https links")).toBeInTheDocument();
  });

  it("I3 imports once on a double tap, saying it is importing", async () => {
    // Never settles, so the import is still running at every assertion.
    const imported = vi.spyOn(anki, "importAnkiLink").mockReturnValue(new Promise(() => {}));
    const { field, button } = await renderDecks();

    fireEvent.change(field, { target: { value: LINK } });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.submit(field.form as HTMLFormElement);

    expect(imported).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    expect(screen.getByText("Importing…")).toBeInTheDocument();
  });

  it("I4 typing in the link field fires none of /review's keys", async () => {
    const pane = await renderPane();
    const field = screen.getByLabelText("a link to an Anki deck");
    field.focus();

    fireEvent.keyDown(field, { key: "j" });
    fireEvent.keyDown(field, { key: "p" });

    expect(document.activeElement).toBe(field);
    expect(pane.querySelector("button[data-deck]")).not.toBeNull();

    // The same `p` on the pane does open the parked list, so the deck rows
    // still standing above is the field holding the key and not a dead key.
    fireEvent.keyDown(pane, { key: "p" });
    expect(pane.querySelector("button[data-deck]")).toBeNull();
  });

  it("I5 keeps the link after a failure and clears it after a success", async () => {
    const imported = vi
      .spyOn(anki, "importAnkiLink")
      .mockRejectedValueOnce(new Error("AnkiWeb did not answer"))
      .mockResolvedValueOnce(DONE);
    const { field, button } = await renderDecks();

    fireEvent.change(field, { target: { value: LINK } });
    fireEvent.click(button);
    await screen.findByText("AnkiWeb did not answer");
    expect(field.value).toBe(LINK);

    fireEvent.click(button);
    await screen.findByText(SUMMARY);
    expect(field.value).toBe("");
    expect(imported).toHaveBeenCalledTimes(2);
  });

  it("A7 shows a refusal's detail word for word", async () => {
    const detail = "That page is not an AnkiWeb shared deck, and the link is not an .apkg";
    vi.spyOn(anki, "importAnkiLink").mockRejectedValue(new Error(detail));
    const { field, button } = await renderDecks();

    fireEvent.change(field, { target: { value: LINK } });
    fireEvent.click(button);

    expect((await screen.findByText(detail)).textContent).toBe(detail);
  });
});
