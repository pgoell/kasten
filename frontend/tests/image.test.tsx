import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { Editor } from "@/components/editor";
import { IMAGE_FOLDER, imageCompletions, imagePaths } from "@/lib/image";

// The upload is the one thing here that leaves the browser. Standing in for the
// module is the right level: what these tests own is which path the paste writes
// and what it puts in the note, not the HTTP.
const { uploadAsset } = vi.hoisted(() => ({ uploadAsset: vi.fn() }));
vi.mock("@/lib/api", () => ({ uploadAsset }));

const SHOT = `${IMAGE_FOLDER}/2026-08-12-abcdef01.png`;

/** The path as a note spells it, which is the one a markdown destination takes. */
const ENCODED = encodeURI(SHOT);

function open(initialDoc: string, images?: string[]) {
  const onChange = vi.fn();
  const onNotice = vi.fn();
  const { container } = render(
    <Editor initialDoc={initialDoc} images={images} onChange={onChange} onNotice={onNotice} />,
  );

  return {
    container,
    editor: container.querySelector(".cm-content") as HTMLElement,
    onNotice,
    /** The document itself, which the rendering hides the marks of. */
    doc: () => (onChange.mock.lastCall?.[0] as string | undefined) ?? initialDoc,
  };
}

/** One image on the clipboard, in the shape a screenshot arrives in. */
function pasteImage(editor: HTMLElement, type = "image/png") {
  const file = new File(["bytes"], "image.png", { type });
  fireEvent.paste(editor, { clipboardData: { files: [file], getData: () => "" } });
  return file;
}

describe("rendering an image", () => {
  it("draws the picture the path names and hides the text naming it", () => {
    const { container } = open(`![a shot](${ENCODED})`);

    const image = container.querySelector("img.cm-image") as HTMLImageElement;
    expect(image).not.toBeNull();
    expect(image.getAttribute("src")).toBe(`/api/assets/${ENCODED}`);
    // The alt text the note wrote, so a picture that will not load still says
    // what it was.
    expect(image.alt).toBe("a shot");
    expect(container.querySelector(".cm-content")?.textContent).toBe("");
  });

  it("hands the source back on the line being edited", async () => {
    const { container, editor } = open(`![a shot](${ENCODED})`);

    fireEvent.keyDown(editor, { key: "i" });

    await waitFor(() => expect(container.querySelector("img.cm-image")).toBeNull());
    expect(container.querySelector(".cm-content")?.textContent).toContain(`![a shot](${ENCODED})`);
  });

  it("leaves an address somewhere else as the text of it", () => {
    // `img-src` allows this origin alone, so drawing this would draw a broken
    // picture where the source at least says what was meant.
    const { container } = open("![](https://example.com/shot.png)");

    expect(container.querySelector("img.cm-image")).toBeNull();
    expect(container.querySelector(".cm-content")?.textContent).toContain("https://");
  });

  it("draws a link as a link, that being no image", () => {
    const { container } = open(`[a shot](${ENCODED})`);

    expect(container.querySelector("img.cm-image")).toBeNull();
    expect(container.querySelector(".cm-content")?.textContent).toBe("a shot");
  });
});

describe("the image key", () => {
  it("makes an image of the link under the cursor", async () => {
    const { editor, doc } = open(`[a shot](${ENCODED})`);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "c" });
    fireEvent.keyDown(editor, { key: "i" });

    await waitFor(() => expect(doc()).toBe(`![a shot](${ENCODED})`));
  });

  it("hands the link back when the cursor is on an image", async () => {
    const { editor, doc } = open(`![a shot](${ENCODED})`);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "c" });
    fireEvent.keyDown(editor, { key: "i" });

    await waitFor(() => expect(doc()).toBe(`[a shot](${ENCODED})`));
  });

  it("writes the empty pair where there is neither", async () => {
    const { editor, doc } = open("");

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "c" });
    fireEvent.keyDown(editor, { key: "i" });

    await waitFor(() => expect(doc()).toBe("![]()"));
  });
});

describe("completing an image path", () => {
  function offered(before: string, images: string[] | null = [SHOT]) {
    const state = EditorState.create({
      doc: before,
      extensions: images === null ? [] : [imagePaths.of(images)],
    });
    return imageCompletions(new CompletionContext(state, before.length, true));
  }

  it("offers every image in the vault inside an open bracket", () => {
    const found = offered("![](");

    expect(found?.options.map(({ label }) => label)).toEqual(["2026-08-12-abcdef01.png"]);
    // The name is what the list reads and the whole path is what goes in, so a
    // folder of screenshots is legible while the note holds something the
    // backend answers to.
    expect(found?.options[0]?.apply).toBe(ENCODED);
    expect(found?.from).toBe("![](".length);
  });

  it("keeps offering them as the path is typed", () => {
    expect(offered("![](99%20Misc/02")?.options).toHaveLength(1);
  });

  it("offers nothing inside a wikilink or a plain link", () => {
    expect(offered("[[")).toBeNull();
    expect(offered("[a shot](")).toBeNull();
  });

  it("offers nothing where the vault is not known, as in a preview pane", () => {
    expect(offered("![](", null)).toBeNull();
  });
});

describe("pasting an image", () => {
  beforeEach(() => {
    uploadAsset.mockReset();
    uploadAsset.mockResolvedValue(undefined);
  });

  it("puts it in the images folder and writes the reference to it", async () => {
    const { editor, doc } = open("");

    const file = pasteImage(editor);

    await waitFor(() => expect(uploadAsset).toHaveBeenCalledTimes(1));
    const [path, sent] = uploadAsset.mock.lastCall as [string, File];
    expect(sent).toBe(file);
    // Today and eight hex digits, the clipboard calling every image `image.png`
    // and the vault overwriting nothing.
    expect(path).toMatch(new RegExp(`^${IMAGE_FOLDER}/\\d{4}-\\d{2}-\\d{2}-[\\da-f]{8}\\.png$`));
    await waitFor(() => expect(doc()).toBe(`![](${encodeURI(path)})`));
  });

  it("writes nothing into the note when the vault refuses", async () => {
    uploadAsset.mockRejectedValue(new Error("Something is already there"));
    const { editor, doc, onNotice } = open("plain");

    pasteImage(editor);

    await waitFor(() => expect(onNotice).toHaveBeenCalledWith("Something is already there"));
    expect(doc()).toBe("plain");
  });

  it("leaves a paste carrying no image to the editor's own", () => {
    const { editor } = open("");

    fireEvent.paste(editor, { clipboardData: { files: [], getData: () => "some text" } });

    expect(uploadAsset).not.toHaveBeenCalled();
  });
});
