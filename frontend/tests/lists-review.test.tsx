import { fireEvent, render, screen, within } from "@testing-library/react";
import { ListsApp } from "@/lists/lists-app";
import { fakeShare, type Seed } from "./lists-fixture";

beforeEach(() => {
  localStorage.clear();
});

/** The timeout of a request a test left hanging, aborted after the test so the store's drain lock is free. */
let hung: AbortController | undefined;

afterEach(() => {
  hung?.abort(new DOMException("The operation timed out.", "TimeoutError"));
  hung = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The words of the done items in the folded or unfolded Erledigt group. */
const doneWords = () =>
  within(screen.getByRole("region", { name: "Erledigt" }))
    .getAllByRole("checkbox")
    .map((box) => box.textContent);

/** The people the open chip menu offers, in order. */
const menuOptions = () =>
  within(screen.getByRole("menu"))
    .queryAllByRole("menuitemradio")
    .map((option) => option.textContent);

/** `/share/me` answers 500 while `failing` is true; every other request is the fake's. */
function meFailing(share: ReturnType<typeof fakeShare>, failing: { on: boolean }) {
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
    url === "/share/me" && failing.on
      ? Promise.resolve(new Response("{}", { status: 500 }))
      : share.fetch(url, init),
  );
}

describe("the review fixes", () => {
  it("#810 R7.1 an item ticked on the phone shows among the folded Erledigt rows at once", async () => {
    const seed: Seed[] = [
      { text: "Eier", done: false },
      { text: "Alt", done: true, ticked_at: "2020-10-20T10:00:00Z" },
      { text: "Mittel", done: true, ticked_at: "2020-10-21T10:00:00Z" },
      { text: "Neu", done: true, ticked_at: "2020-10-22T10:00:00Z" },
    ];
    const share = fakeShare({ Einkauf: seed, Todo: [] });
    vi.stubGlobal("fetch", share.fetch);
    // The server does not answer the tick, so only the phone's own view can show it. The
    // request's timeout is held here, so the test can give it up at the end: a request
    // left hanging would hold the store's one drain lock for the next test.
    hung = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(hung.signal);
    share.hangNext();
    render(<ListsApp />);

    fireEvent.click(await screen.findByRole("checkbox", { name: "Eier" }));

    expect(doneWords()).toEqual(["Eier", "Neu", "Mittel"]);
  });

  it("#810 R7.2a a first read of who it is that fails is read again at the next sync", async () => {
    const share = fakeShare({ Einkauf: [{ text: "Milch", done: false }], Todo: [] });
    const failing = { on: true };
    meFailing(share, failing);
    render(<ListsApp />);

    fireEvent.click(await screen.findByRole("button", { name: "Wer?" }));
    expect(menuOptions()).toEqual(["Niemand"]);

    failing.on = false;
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(menuOptions()).toEqual(["Pascal", "Alicia", "Niemand"]));
  });

  it("#810 R7.2b a page whose read of who it is fails still shows Ich from the last session", async () => {
    const seed: Seed[] = [{ text: "Milch", done: false, assignee: "[[Pascal]]" }];
    // The first session reads who it is and remembers it.
    vi.stubGlobal("fetch", fakeShare({ Einkauf: seed, Todo: [] }).fetch);
    const first = render(<ListsApp />);
    await screen.findByRole("button", { name: "Ich" });
    first.unmount();

    // The next page cannot read who it is: the answer comes from the last session.
    const share = fakeShare({ Einkauf: seed, Todo: [] });
    meFailing(share, { on: true });
    render(<ListsApp />);

    expect(await screen.findByRole("button", { name: "Ich" })).toBeInTheDocument();
  });

  it("#810 R7.3 a pick on the second of two same-named items names the line it showed", async () => {
    const share = fakeShare({
      Einkauf: [
        { text: "Milch", done: false, assignee: "[[Alicia]]" },
        { text: "Milch", done: false },
      ],
      Todo: [],
    });
    vi.stubGlobal("fetch", share.fetch);
    render(<ListsApp />);

    // The second Milch is the one with nobody on it.
    fireEvent.click(await screen.findByRole("button", { name: "Wer?" }));
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitemradio", { name: "Pascal" }),
    );

    await vi.waitFor(() =>
      expect(share.posts.at(-1)?.body).toEqual({ line: 1, assignee: "Pascal", sha: "1" }),
    );
    expect(screen.getByRole("button", { name: "Alicia" })).toBeInTheDocument();
  });
});
