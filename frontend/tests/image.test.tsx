import { CompletionContext } from "@codemirror/autocomplete";
import { undo } from "@codemirror/commands";
import { forceParsing } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { Editor } from "@/components/editor";
import { ARCHIVE, applyLayout, INBOX, type Layout, PERIODIC } from "@/lib/core/layout";
import { toggleVim } from "@/lib/notes/editor/vim-setting";
import { IMAGE_FOLDER, imageCompletions, imagePaths } from "@/lib/notes/embeds/image";
import { uploads } from "./upload-backend-fixture";

// The upload is the one thing here that leaves the browser. Standing in for the
// module is the right level: what these tests own is which path the paste writes
// and what it puts in the note, not the HTTP.
const { uploadAsset } = vi.hoisted(() => ({ uploadAsset: vi.fn() }));
// Partial, so the video file past 100 MB can go through the real pieces.
vi.mock("@/lib/core/api", async (actual) => ({ ...(await actual<object>()), uploadAsset }));

const SHOT = `${IMAGE_FOLDER}/2026-08-12-abcdef01.png`;

/** The default folders, which a test that serves another images folder puts back. */
const LAYOUT: Layout = {
  inbox: INBOX,
  periodic: PERIODIC,
  archive: ARCHIVE,
  images: IMAGE_FOLDER,
  config: "99 Misc/01 Config",
};

/** The path as a note spells it, which is the one a markdown destination takes. */
const ENCODED = encodeURI(SHOT);

function open(initialDoc: string, images?: string[], paths?: string[]) {
  const onChange = vi.fn();
  const onNotice = vi.fn();
  const { container } = render(
    <Editor
      initialDoc={initialDoc}
      images={images}
      paths={paths}
      onChange={onChange}
      onNotice={onNotice}
    />,
  );
  // The parse at state creation gets 20ms of wall clock; on a loaded machine
  // the first draw can come before the image node exists (#365, #436).
  const view = EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement);
  act(() => {
    if (view) forceParsing(view, view.state.doc.length, 5000);
  });

  return {
    container,
    view: view as EditorView,
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

  it("draws a picture whose name holds # or ?, from the path the note spelled", () => {
    const { container } = open("![a plan](99%20Misc/plan%20%232%3F.png)");

    expect(container.querySelector("img.cm-image")?.getAttribute("src")).toBe(
      "/api/assets/99%20Misc/plan%20%232%3F.png",
    );
  });

  it("draws an https address as it stands, sending no referrer", () => {
    const { container } = open("![a chart](https://example.com/shot.png?v=1)");

    const image = container.querySelector("img.cm-image") as HTMLImageElement;
    expect(image.getAttribute("src")).toBe("https://example.com/shot.png?v=1");
    expect(image.referrerPolicy).toBe("no-referrer");
  });

  it("leaves an address it cannot load as the text of it", () => {
    // `http:` is mixed content on an https page, so drawing this would draw a
    // broken picture where the source at least says what was meant.
    const { container } = open("![](http://example.com/shot.png)");

    expect(container.querySelector("img.cm-image")).toBeNull();
    expect(container.querySelector(".cm-content")?.textContent).toContain("http://");
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

  it("writes # and ? in a name escaped, so the note's path does not end at them", () => {
    const found = offered("![](", ["99 Misc/plan #2?.png"]);

    expect(found?.options[0]?.apply).toBe("99%20Misc/plan%20%232%3F.png");
  });

  it("leaves a comma raw, the spelling a folder move looks for", () => {
    const found = offered("![](", ["Trips, 2024/beach #1.png"]);

    expect(found?.options[0]?.apply).toBe("Trips,%202024/beach%20%231.png");
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

  it("files a pasted svg under .svg, the suffix the vault takes", async () => {
    const { editor, doc } = open("");

    pasteImage(editor, "image/svg+xml");

    await waitFor(() => expect(uploadAsset).toHaveBeenCalledTimes(1));
    const [path] = uploadAsset.mock.lastCall as [string, File];
    expect(path).toMatch(new RegExp(`^${IMAGE_FOLDER}/\\d{4}-\\d{2}-\\d{2}-[\\da-f]{8}\\.svg$`));
    await waitFor(() => expect(doc()).toBe(`![](${encodeURI(path)})`));
  });

  it("escapes # and ? in the images folder the vault named", async () => {
    const images = IMAGE_FOLDER;
    applyLayout({ ...LAYOUT, images: "Files #1/what?" });
    try {
      const { editor, doc } = open("");
      pasteImage(editor);

      await waitFor(() => expect(uploadAsset).toHaveBeenCalledTimes(1));
      const [path] = uploadAsset.mock.lastCall as [string, File];
      const name = path.slice(path.lastIndexOf("/") + 1);
      await waitFor(() => expect(doc()).toBe(`![](Files%20%231/what%3F/${name})`));
    } finally {
      applyLayout({ ...LAYOUT, images });
    }
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

/** Video files as a paste or a drop hands them over. */
function hand(how: "paste" | "drop", editor: HTMLElement, files: File[]) {
  if (how === "paste") {
    fireEvent.paste(editor, { clipboardData: { files, getData: () => "" } });
  } else {
    fireEvent.drop(editor, { dataTransfer: { files, getData: () => "" } });
  }
}

const walk = (name = "walk.mp4", type = "video/mp4") => new File(["bytes"], name, { type });

describe("pasting or dropping a video file (#1922)", () => {
  beforeEach(() => {
    uploadAsset.mockReset();
    uploadAsset.mockResolvedValue(undefined);
  });

  // Vim is on in a test unless toggled, a pointer being fine.
  it.each([
    ["paste", "on"],
    ["drop", "on"],
    ["paste", "off"],
    ["drop", "off"],
  ] as const)("a %s with vim %s files it under its own name and embeds it", async (how, vim) => {
    if (vim === "off") act(() => toggleVim());
    try {
      const { editor, doc } = open("");
      const file = walk();

      hand(how, editor, [file]);

      await waitFor(() =>
        expect(uploadAsset).toHaveBeenCalledWith(`${IMAGE_FOLDER}/walk.mp4`, file),
      );
      await waitFor(() => expect(doc()).toBe("![[walk.mp4]]"));
    } finally {
      if (vim === "off") act(() => toggleVim());
    }
  });

  it("writes the embed at the cursor of a paste", async () => {
    act(() => toggleVim());
    onTestFinished(() => act(() => toggleVim()));
    const { editor, view, doc } = open("before after");
    act(() => view.dispatch({ selection: { anchor: 7 } }));

    hand("paste", editor, [walk("run.webm", "video/webm")]);

    await waitFor(() => expect(doc()).toBe("before ![[run.webm]]after"));
  });

  it("writes the embed where the file was dropped", async () => {
    act(() => toggleVim());
    onTestFinished(() => act(() => toggleVim()));
    const { editor, view, doc } = open("ab");
    act(() => view.dispatch({ selection: { anchor: 2 } }));
    // jsdom lays nothing out, so the point under the drop is stood in for.
    const at = vi.spyOn(view, "posAtCoords").mockReturnValue(1);

    hand("drop", editor, [walk()]);

    await waitFor(() => expect(doc()).toBe("a![[walk.mp4]]b"));
    at.mockRestore();
  });

  it("numbers a name any folder holds in any case, and overwrites nothing", async () => {
    const paths = ["a.md", "clips/WALK.mp4", "x/walk 1.mp4"];
    const { editor, doc } = open("", undefined, paths);

    hand("paste", editor, [walk()]);

    await waitFor(() => expect(doc()).toBe("![[walk 2.mp4]]"));
    expect(uploadAsset).toHaveBeenCalledWith(`${IMAGE_FOLDER}/walk 2.mp4`, expect.any(File));
  });

  it("files each of several, one embed to a line, two of one name apart", async () => {
    const { editor, doc } = open("");

    hand("drop", editor, [walk(), walk(), walk("run.webm", "video/webm")]);

    await waitFor(() => expect(doc()).toBe("![[walk.mp4]]\n![[walk 1.mp4]]\n![[run.webm]]"));
  });

  it("writes nothing into the note when the vault refuses, and says why", async () => {
    uploadAsset.mockRejectedValue(new Error("Something is already there"));
    const { editor, doc, onNotice } = open("plain");

    hand("drop", editor, [walk()]);

    await waitFor(() => expect(onNotice).toHaveBeenCalledWith("Something is already there"));
    expect(doc()).toBe("plain");
  });

  it("takes the embed back out with one undo", async () => {
    act(() => toggleVim());
    onTestFinished(() => act(() => toggleVim()));
    const { editor, view, doc } = open("plain");

    hand("paste", editor, [walk()]);
    await waitFor(() => expect(doc()).toBe("![[walk.mp4]]plain"));

    act(() => {
      undo(view);
    });
    expect(view.state.doc.toString()).toBe("plain");
  });

  it("files a name a wikilink cannot carry under one it can, and a nameless one by date", async () => {
    const { editor, doc } = open("");

    hand("paste", editor, [walk("a [b] | c#d^e.mp4"), walk("clip", "video/webm")]);

    await waitFor(() => expect(uploadAsset).toHaveBeenCalledTimes(2));
    const [nameless] = uploadAsset.mock.lastCall as [string, File];
    expect(nameless).toMatch(
      new RegExp(`^${IMAGE_FOLDER}/\\d{4}-\\d{2}-\\d{2}-[\\da-f]{8}\\.webm$`),
    );
    const name = nameless.slice(nameless.lastIndexOf("/") + 1);
    await waitFor(() => expect(doc()).toBe(`![[a -b- - c-d-e.mp4]]\n![[${name}]]`));
  });

  it("leaves a drop carrying no video file to the editor's own", () => {
    const { editor } = open("");

    hand("drop", editor, [new File(["text"], "notes.txt", { type: "text/plain" })]);

    expect(uploadAsset).not.toHaveBeenCalled();
  });

  it("sends a file past 100 MB in pieces through /api/uploads, then embeds it", async () => {
    const { uploadAsset: real } = await vi.importActual<{ uploadAsset: typeof uploadAsset }>(
      "@/lib/core/api",
    );
    uploadAsset.mockImplementation(real);
    const sent = uploads();
    // A fake: it says 105 MiB and hands out pieces of the size asked, holding no bytes itself.
    const big = walk();
    const size = 105 * 1024 * 1024;
    const sized = (bytes: number) => Object.defineProperty(new Blob(), "size", { value: bytes });
    Object.defineProperties(big, {
      size: { value: size },
      slice: { value: (start: number, end: number) => sized(end - start) },
    });
    const { editor, doc } = open("");

    hand("paste", editor, [big]);

    await waitFor(() => expect(doc()).toBe("![[walk.mp4]]"));
    expect(sent[0]).toBe(`POST /api/uploads {"size":${size}}`);
    expect(sent.filter((line) => line.startsWith("PUT /api/uploads/u1/"))).toHaveLength(11);
    expect(sent.at(-1)).toBe(
      `POST /api/assets/${encodeURIComponent(`${IMAGE_FOLDER}/walk.mp4`)}?upload=u1`,
    );
    vi.unstubAllGlobals();
  });
});
