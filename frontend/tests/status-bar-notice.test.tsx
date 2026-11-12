import { undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { Editor } from "@/components/editor";
import { StatusBar } from "@/components/status-bar";
import { NoteMissing } from "@/lib/core/api";
import { toggleVim } from "@/lib/notes/editor/vim-setting";
import { IMAGE_FOLDER } from "@/lib/notes/embeds/image";
import { saveQueue } from "@/lib/notes/note/save-queue";
import type { EditorCommands } from "@/lib/ui/keys/key-bindings";
import { Leaving } from "@/lib/ui/motion/leaving";
import { paletteEntries } from "@/lib/ui/palette";
import { CLIP_SUFFIXES, IMAGE_SUFFIXES } from "@/lib/vault/file-kind";

// The upload and the conditional write are the two requests a paste sends; what the bar and
// the note show of them is what these tests own (#1945).
const { uploadAsset, updateNote } = vi.hoisted(() => ({
  uploadAsset: vi.fn(),
  updateNote: vi.fn(),
}));
vi.mock("@/lib/core/api", async (actual) => ({
  ...(await actual<object>()),
  uploadAsset,
  updateNote,
}));

// The frontend's own half of the reading is stamped in at build time, so it is
// whatever commit the checkout running these tests is on. Mocked to a fixed one
// rather than read, or the cases below would assert against the working tree.
const { BUILD } = vi.hoisted(() => ({ BUILD: { value: "" } }));
vi.mock("@/lib/app/build", () => ({
  get BUILD() {
    return BUILD.value;
  },
}));

afterEach(() => {
  BUILD.value = "";
});

describe("the clock in the bar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("puts one sentence about a failure in the bar, with no note open", () => {
    render(<StatusBar notice="A book is already there" />);

    expect(screen.getByText("A book is already there")).toBeInTheDocument();
  });

  it("gives a notice the clock's room below md", () => {
    const { rerender } = render(<StatusBar />);
    const clock = () => screen.getByText(/^CW \d+$/).parentElement;
    expect(clock()).not.toHaveClass("max-md:hidden");

    rerender(<StatusBar notice="A book is already there" />);
    expect(clock()).toHaveClass("max-md:hidden");
  });

  it("opens a notice out in full on a tap, and shuts it on the next", () => {
    // A finger cannot hover, so the `title` that carries the rest is no use.
    render(<StatusBar notice="A book is already there" />);
    expect(screen.queryByTestId("status-detail")).toBeNull();

    fireEvent.click(screen.getByTestId("notice"));
    expect(screen.getByTestId("status-detail")).toHaveTextContent("A book is already there");

    fireEvent.click(screen.getByTestId("status-detail"));
    expect(screen.queryByTestId("status-detail")).toBeNull();
  });

  it("shuts with the notice it showed, so the next one arrives closed", () => {
    const { rerender } = render(<StatusBar notice="A book is already there" />);
    fireEvent.click(screen.getByTestId("notice"));
    expect(screen.getByTestId("status-detail")).toBeInTheDocument();

    rerender(<StatusBar />);
    rerender(<StatusBar notice="The upload was too large" />);
    expect(screen.queryByTestId("status-detail")).toBeNull();

    // One notice replacing another shuts it as well, nobody having asked for
    // the second in full.
    fireEvent.click(screen.getByTestId("notice"));
    rerender(<StatusBar notice="A book is already there" />);
    expect(screen.queryByTestId("status-detail")).toBeNull();
  });

  it("cuts a long notice short rather than widen the bar", () => {
    render(<StatusBar notice="A book is already there" />);

    const notice = screen.getByTestId("notice");
    expect(notice).toHaveClass("truncate");
    expect(notice).toHaveAttribute("title", "A book is already there");
  });

  it("draws the notice before the archive tag", () => {
    render(<StatusBar notice="A book is already there" archive />);

    const notice = screen.getByText("A book is already there");
    // The order and not the Tailwind class: a class assertion is a change
    // detector, and the colour is a design choice rather than behaviour.
    expect(notice.compareDocumentPosition(screen.getByTestId("archive-shown"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});

/** An upload held open, with the progress it was handed and the two ways to end it. */
function holdUploads() {
  const held: { progress: (sent: number, total: number) => void; end: (error?: Error) => void }[] =
    [];
  uploadAsset.mockImplementation(
    (_path: string, _file: File, progress: (sent: number, total: number) => void) =>
      new Promise<void>((resolve, reject) => {
        held.push({ progress, end: (error) => (error ? reject(error) : resolve()) });
      }),
  );
  return held;
}

const clip = (name = "walk.mp4") => new File(["bytes"], name, { type: "video/mp4" });

function paste(file: File, container: HTMLElement = document.body) {
  const editor = container.querySelector(".cm-content") as HTMLElement;
  fireEvent.paste(editor, { clipboardData: { files: [file], getData: () => "" } });
}

/** A note's editor beside the bar, the route's way: a notice goes to the bar. */
function Page({
  path = "a.md",
  quiet,
  leaving = false,
}: {
  path?: string;
  quiet?: boolean;
  leaving?: boolean;
}) {
  const [notice, setNotice] = useState<string>();
  return (
    <>
      <Leaving.Provider value={leaving}>
        <Editor
          key={path}
          path={path}
          initialDoc={`text of ${path}`}
          onNotice={setNotice}
          onChange={changed}
        />
      </Leaving.Provider>
      <StatusBar notice={notice} quiet={quiet} />
    </>
  );
}
const changed = vi.fn();
const reading = () => screen.queryByTestId("uploading")?.textContent;

describe("an upload pasted into a note (#1945)", () => {
  beforeEach(() => {
    uploadAsset.mockReset();
    updateNote.mockReset();
    updateNote.mockResolvedValue(null);
    changed.mockReset();
  });

  it("shows the file and how far it got from the start, and clears when it ends", async () => {
    const held = holdUploads();
    render(<Page />);

    paste(clip());
    await waitFor(() => expect(reading()).toBe("Uploading walk.mp4 0%"));
    // The clock gives way below md, as it does to a notice.
    expect(screen.getByText(/^CW \d+$/).parentElement).toHaveClass("max-md:hidden");
    act(() => held[0]?.progress(42, 100));
    expect(reading()).toBe("Uploading walk.mp4 42%");

    act(() => held[0]?.end());
    await waitFor(() =>
      expect(changed).toHaveBeenLastCalledWith(expect.stringContaining("![[walk.mp4]]")),
    );
    expect(reading()).toBeUndefined();
  });

  it("clears on a failure, and the bar says it failed", async () => {
    const held = holdUploads();
    render(<Page />);
    paste(clip());
    await waitFor(() => expect(reading()).toBeDefined());

    act(() => held[0]?.end(new Error("POST /api/assets failed with 413")));

    await waitFor(() =>
      expect(screen.getByTestId("notice")).toHaveTextContent("POST /api/assets failed with 413"),
    );
    expect(reading()).toBeUndefined();
  });

  it("is drawn on a phone's quiet bar, which has nothing else to say", async () => {
    const held = holdUploads();
    render(<Page quiet />);
    expect(screen.queryByRole("contentinfo")).toBeNull();

    paste(clip());

    await waitFor(() => expect(reading()).toBe("Uploading walk.mp4 0%"));
    act(() => held[0]?.end());
    await waitFor(() => expect(screen.queryByRole("contentinfo")).toBeNull());
  });

  it("names the oldest of two and counts the other, until the last ends", async () => {
    const held = holdUploads();
    render(<Page />);
    paste(clip());
    paste(clip("run.mp4"));
    await waitFor(() => expect(reading()).toBe("Uploading walk.mp4 0% +1"));

    act(() => held[0]?.end());
    await waitFor(() => expect(reading()).toBe("Uploading run.mp4 0%"));
    act(() => held[1]?.end());
    await waitFor(() => expect(reading()).toBeUndefined());
  });

  it("writes the embed into the file of a note closed before the upload ended, not the note open now", async () => {
    const held = holdUploads();
    const { rerender } = render(<Page path="a.md" />);
    paste(clip());
    await waitFor(() => expect(held).toHaveLength(1));
    // The way a pane leaves a note: the editor stays a task longer with its callbacks emptied.
    rerender(<Page path="a.md" leaving />);
    rerender(<Page path="b.md" />);

    act(() => held[0]?.end());

    await waitFor(() => expect(updateNote).toHaveBeenCalledTimes(1));
    expect(updateNote).toHaveBeenCalledWith("a.md", expect.any(Function));
    expect(changed).not.toHaveBeenCalled();
    expect(screen.getByText("text of b.md")).toBeInTheDocument();
  });

  it.each([
    ["typed meanwhile", "typed meanwhile\n![[walk.mp4]]\n"],
    ["typed meanwhile\n", "typed meanwhile\n![[walk.mp4]]\n"],
    ["", "![[walk.mp4]]\n"],
    ["---\ntags: [a]\n---", "---\ntags: [a]\n---\n![[walk.mp4]]\n"],
  ])("puts it on a line of its own after the text the vault holds now: %j", async (now, after) => {
    const held = holdUploads();
    const { unmount } = render(<Page />);
    paste(clip());
    await waitFor(() => expect(held).toHaveLength(1));
    unmount();

    act(() => held[0]?.end());

    await waitFor(() => expect(updateNote).toHaveBeenCalled());
    expect(updateNote.mock.calls[0]?.[1](now)).toBe(after);
  });

  it("writes after the closed note's own save in the air has answered", async () => {
    const held = holdUploads();
    let answer = (_: boolean) => {};
    const settled = vi
      .spyOn(saveQueue, "settled")
      .mockReturnValue(new Promise<boolean>((resolve) => (answer = resolve)));
    const { unmount } = render(<Page />);
    paste(clip());
    await waitFor(() => expect(held).toHaveLength(1));
    unmount();

    act(() => held[0]?.end());
    await waitFor(() => expect(settled).toHaveBeenCalledWith("a.md"));
    expect(updateNote).not.toHaveBeenCalled();

    answer(true);
    await waitFor(() => expect(updateNote).toHaveBeenCalledTimes(1));
    settled.mockRestore();
  });

  it("puts it in an editor open on the note now, once, and not in the file", async () => {
    const held = holdUploads();
    const first = render(<Editor path="a.md" initialDoc="old" />);
    paste(clip(), first.container);
    await waitFor(() => expect(held).toHaveLength(1));
    first.unmount();
    render(<Editor path="a.md" initialDoc="reopened" onChange={changed} />);

    act(() => held[0]?.end());

    await waitFor(() => expect(changed).toHaveBeenLastCalledWith("reopened\n![[walk.mp4]]\n"));
    expect(changed).toHaveBeenCalledTimes(1);
    expect(updateNote).not.toHaveBeenCalled();
  });

  it("writes each file of a paste on its own line once the note closed", async () => {
    const held = holdUploads();
    const { container, unmount } = render(<Page />);
    const editor = container.querySelector(".cm-content") as HTMLElement;
    fireEvent.paste(editor, {
      clipboardData: { files: [clip(), clip("run.mp4")], getData: () => "" },
    });
    await waitFor(() => expect(held).toHaveLength(1));
    unmount();

    act(() => held[0]?.end());
    await waitFor(() => expect(held).toHaveLength(2));
    act(() => held[1]?.end());

    await waitFor(() => expect(updateNote).toHaveBeenCalledTimes(2));
    const [one, two] = updateNote.mock.calls.map((call) => call[1]);
    expect(two(one("x"))).toBe("x\n![[walk.mp4]]\n![[run.mp4]]\n");
  });

  it("makes no note again when the closed one is gone, and says where the file is", async () => {
    const held = holdUploads();
    updateNote.mockRejectedValue(new NoteMissing("a.md"));
    const { rerender } = render(<Page path="a.md" />);
    paste(clip());
    await waitFor(() => expect(held).toHaveLength(1));
    // The way a pane leaves a note: the editor stays a task longer with its callbacks emptied.
    rerender(<Page path="a.md" leaving />);
    rerender(<Page path="b.md" />);

    act(() => held[0]?.end());

    await waitFor(() =>
      expect(screen.getByTestId("notice")).toHaveTextContent(
        `The file is in ${IMAGE_FOLDER}, but a.md is gone`,
      ),
    );
  });

  it("still says so when the upload fails after its note closed", async () => {
    const held = holdUploads();
    const { rerender } = render(<Page path="a.md" />);
    paste(clip());
    await waitFor(() => expect(held).toHaveLength(1));
    rerender(<Page path="a.md" leaving />);
    rerender(<Page path="b.md" />);

    act(() => held[0]?.end(new Error("POST /api/assets failed with 413")));

    await waitFor(() =>
      expect(screen.getByTestId("notice")).toHaveTextContent("POST /api/assets failed with 413"),
    );
    expect(updateNote).not.toHaveBeenCalled();
  });

  it("writes the file, not the leaving editor, when the upload ends while its note leaves", async () => {
    const held = holdUploads();
    const { rerender } = render(<Page path="a.md" />);
    paste(clip());
    await waitFor(() => expect(held).toHaveLength(1));
    rerender(<Page path="a.md" leaving />);

    act(() => held[0]?.end());

    await waitFor(() => expect(updateNote).toHaveBeenCalledWith("a.md", expect.any(Function)));
    expect(changed).not.toHaveBeenCalled();
  });

  it("puts it at the cursor of an editor that has no note and no onChange, as the scratch editor", async () => {
    const held = holdUploads();
    const { container } = render(<Editor initialDoc="" />);
    paste(clip(), container);
    await waitFor(() => expect(held).toHaveLength(1));

    act(() => held[0]?.end());

    await waitFor(() =>
      expect(container.querySelector(".cm-content")?.textContent).toContain("walk.mp4"),
    );
    expect(updateNote).not.toHaveBeenCalled();
  });
});

const ROW = "Pick an image or video file into this note";
const noCommands = new Proxy({}, { get: () => () => undefined }) as EditorCommands;
const shot = (name = "shot.png", type = "image/png") => new File(["b"], name, { type });

/** Taps the palette's row over the note's editor, and answers the input it clicked and its pick. */
function openPicker(container: HTMLElement = document.body) {
  const view = EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement);
  const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => undefined);
  const row = paletteEntries(noCommands, view).find((entry) => entry.label === ROW);
  act(() => row?.run());
  // In the tap itself, no await between: the browser shows no picker after one.
  expect(click).toHaveBeenCalledTimes(1);
  const input = click.mock.contexts[0] as HTMLInputElement;
  click.mockRestore();
  const pick = (...files: File[]) => {
    Object.defineProperty(input, "files", { value: files, configurable: true });
    fireEvent.change(input);
  };
  return { view: view as EditorView, input, pick };
}

describe("a file picked into a note (#1946)", () => {
  beforeEach(() => {
    uploadAsset.mockReset();
    updateNote.mockReset();
    updateNote.mockResolvedValue(null);
    changed.mockReset();
  });

  it.each(["on", "off"])(
    "with vim %s goes up on the bar and lands at the cursor as a paste",
    async (vim) => {
      if (vim === "off") act(() => toggleVim());
      onTestFinished(() => {
        if (vim === "off") act(() => toggleVim());
      });
      const held = holdUploads();
      render(<Page />);
      const { view, input, pick } = openPicker();
      expect(input.multiple).toBe(true);
      act(() => view.dispatch({ selection: { anchor: 4 } }));

      pick(clip());
      await waitFor(() => expect(reading()).toBe("Uploading walk.mp4 0%"));
      act(() => held[0]?.end());

      await waitFor(() => expect(changed).toHaveBeenLastCalledWith("text![[walk.mp4]] of a.md"));
      expect(reading()).toBeUndefined();
      act(() => {
        undo(view);
      });
      expect(view.state.doc.toString()).toBe("text of a.md");
    },
  );

  it("files an image under its own name, several in order, a taken name numbered", async () => {
    uploadAsset.mockResolvedValue(undefined);
    render(<Page />);
    const { view, pick } = openPicker();
    act(() => view.dispatch({ selection: { anchor: 0 } }));

    pick(shot(), clip(), shot());

    const ref = (name: string) => `![](${encodeURI(`${IMAGE_FOLDER}/${name}`)})`;
    await waitFor(() =>
      expect(changed).toHaveBeenLastCalledWith(
        `${ref("shot.png")}\n![[walk.mp4]]\n${ref("shot 1.png")}text of a.md`,
      ),
    );
    expect(uploadAsset.mock.calls.map(([path]) => path)).toEqual(
      ["shot.png", "walk.mp4", "shot 1.png"].map((name) => `${IMAGE_FOLDER}/${name}`),
    );
  });

  it("writes into the file of a note closed while the picker was open", async () => {
    uploadAsset.mockResolvedValue(undefined);
    const { rerender } = render(<Page path="a.md" />);
    const { pick } = openPicker();
    rerender(<Page path="b.md" />);

    pick(clip());

    await waitFor(() => expect(updateNote).toHaveBeenCalledWith("a.md", expect.any(Function)));
    const write = updateNote.mock.lastCall?.[1] as (text: string) => string;
    expect(write("x")).toBe("x\n![[walk.mp4]]\n");
    expect(changed).not.toHaveBeenCalled();
  });

  it("names a file the vault does not take and sends the rest, and a cancel sends nothing", async () => {
    uploadAsset.mockResolvedValue(undefined);
    render(<Page />);
    const { view, pick } = openPicker();
    act(() => view.dispatch({ selection: { anchor: 0 } }));

    pick();
    pick(new File(["m"], "IMG_0001.MOV", { type: "video/quicktime" }), clip());

    await waitFor(() =>
      expect(screen.getByTestId("notice")).toHaveTextContent(
        "IMG_0001.MOV is not an image or a video file the vault takes",
      ),
    );
    await waitFor(() => expect(changed).toHaveBeenLastCalledWith("![[walk.mp4]]text of a.md"));
    expect(uploadAsset).toHaveBeenCalledTimes(1);
  });

  it("opens on <leader>ca once the last key is up, as <leader>cb does", () => {
    render(<Page />);
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => undefined);
    const editor = document.querySelector(".cm-content") as HTMLElement;
    for (const key of [" ", "c", "a"]) fireEvent.keyDown(editor, { key, code: key });
    expect(click).not.toHaveBeenCalled();
    for (const key of [" ", "c", "a"]) fireEvent.keyUp(editor, { key, code: key });
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it("writes nothing when the vault refuses, and the bar says why", async () => {
    uploadAsset.mockRejectedValue(new Error("Something is already there"));
    render(<Page />);
    openPicker().pick(shot());

    await waitFor(() =>
      expect(screen.getByTestId("notice")).toHaveTextContent("Something is already there"),
    );
    expect(changed).not.toHaveBeenCalled();
  });

  it("offers only what the vault takes, and clears the last pick so the same file fires again", () => {
    render(<Page />);
    const cleared = vi.spyOn(HTMLInputElement.prototype, "value", "set");
    const { input } = openPicker();

    expect(input.accept.split(",").sort()).toEqual(
      [...IMAGE_SUFFIXES, ...CLIP_SUFFIXES, "image/gif", "image/jpeg", "image/png"]
        .concat(["image/svg+xml", "image/webp", "video/mp4", "video/webm"])
        .sort(),
    );
    expect(cleared).toHaveBeenCalledWith("");
    cleared.mockRestore();
  });
});
