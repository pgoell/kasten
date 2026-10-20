import { fireEvent, screen } from "@testing-library/react";
import { useMemo } from "react";
import type { TodoHit } from "@/lib/api";
import { noteBase } from "@/lib/note-base";
import type { PdfRenderer } from "@/lib/pdf-view";
import type { TodoState } from "@/lib/todo";
import { hashed } from "./digests";
import { defineFoliateFake } from "./foliate-fake";
import { act, editing, pageHooks, settle, somebodyElseWrote, theRoute } from "./home-route-fixture";

defineFoliateFake();

// The doubles, the same in every home-route file: see home-route-fixture.tsx.
const {
  fetchFiles,
  fetchNote,
  saveNote,
  updateNote,
  searchNotes,
  fetchMentions,
  createNote,
  renameNote,
  moveFolder,
  deleteNote,
  fetchTrash,
  restoreEntry,
  fetchTerminals,
  fetchTodos,
  fetchBook,
  uploadAsset,
  fetchImages,
  fetchHtml,
  fetchAssets,
  deleteImage,
  fetchVersion,
  fetchTags,
  fetchHistory,
  fetchHistoryText,
} = vi.hoisted(() => {
  const beside = (note: string, suffix = ".epub") => ({
    path: note.replace(/\.md$/, suffix),
    blob: new Blob(["a book"]),
  });

  const fetchNote = vi.fn();
  const saveNote = vi.fn();

  return {
    beside,
    fetchFiles: vi.fn(),
    fetchNote,
    saveNote,
    updateNote: vi.fn(async (path: string, change: (text: string) => string | null) => {
      const text: string = await fetchNote(path);
      const next = change(text);
      return next === null ? null : saveNote(path, next, false, noteBase(text));
    }),
    searchNotes: vi.fn(),
    fetchMentions: vi.fn(),
    createNote: vi.fn(),
    renameNote: vi.fn(),
    moveFolder: vi.fn(),
    deleteNote: vi.fn(),
    fetchTrash: vi.fn(),
    restoreEntry: vi.fn(),
    fetchTerminals: vi.fn().mockResolvedValue([]),
    fetchTodos: vi.fn().mockResolvedValue([]),
    fetchBook: vi.fn(async (note: string) => beside(note)),
    uploadAsset: vi.fn().mockResolvedValue(undefined),
    fetchImages: vi.fn().mockResolvedValue([]),
    fetchHtml: vi.fn().mockResolvedValue([]),
    fetchAssets: vi.fn().mockResolvedValue([]),
    fetchTags: vi.fn().mockResolvedValue([]),
    deleteImage: vi.fn(),
    fetchVersion: vi.fn().mockResolvedValue("0.8.0"),
    fetchHistory: vi.fn(),
    fetchHistoryText: vi.fn(),
  };
});
vi.mock("@/lib/api", () => ({
  fetchFiles,
  fetchNote,
  saveNote,
  updateNote,
  searchNotes,
  fetchMentions,
  createNote,
  fetchTerminals,
  fetchTodos,
  fetchBook,
  uploadAsset,
  fetchImages,
  fetchHtml,
  fetchAssets,
  fetchVersion,
  fetchTags,
  fetchWeather: async () => [],
  UPLOAD_LIMIT_BYTES: 1024 * 1024 * 1024,
  ChangedOnDisk: class ChangedOnDisk extends Error {},
  NoteExists: class NoteExists extends Error {},
  NoteMissing: class NoteMissing extends Error {},
}));
vi.mock("@/lib/move-api", () => ({ renameNote, moveFolder }));
vi.mock("@/lib/trash-api", () => ({ deleteNote, fetchTrash, restoreEntry, deleteImage }));
vi.mock("@/lib/history-api", () => ({ fetchHistory, fetchHistoryText }));
vi.mock("foliate-js/view.js", () => ({}));
const pdfPaneRenderer = vi.hoisted(() => ({ current: null as PdfRenderer | null }));
vi.mock("@/lib/pdf-view", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/pdf-view")>();
  return {
    ...real,
    pdfjsRenderer: {
      open: (url: string) => (pdfPaneRenderer.current ?? real.pdfjsRenderer).open(url),
    },
  };
});
const paneProps = vi.hoisted(() => ({
  current: null as {
    onRefile: (hit: TodoHit, project?: string) => void;
    onCycle: (hit: TodoHit, state?: TodoState, twins?: number[]) => void;
  } | null,
}));
vi.mock("@/components/todo-pane", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/todo-pane")>();
  function TodoPane(props: Parameters<typeof real.TodoPane>[0]) {
    paneProps.current = props;
    return <real.TodoPane {...props} />;
  }
  return { ...real, TodoPane };
});
const outbox = vi.hoisted(() => ({
  keep: vi.fn(),
  flush: vi.fn(),
  start: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));
vi.mock("@/lib/outbox", () => outbox);
vi.mock("@/lib/fuzzy", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/fuzzy")>();
  return {
    ...real,
    noteCandidates: vi.fn(real.noteCandidates),
    folderCandidates: vi.fn(real.folderCandidates),
    lineCandidates: vi.fn(real.lineCandidates),
  };
});
vi.mock("@/components/file-explorer", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/file-explorer")>();
  const buildTree = vi.fn(real.buildTree);
  function FileExplorer(props: Parameters<typeof real.FileExplorer>[0]) {
    useMemo(
      () => buildTree(props.paths, props.images, props.html, props.pdfs),
      [props.paths, props.images, props.html, props.pdfs],
    );
    return <real.FileExplorer {...props} />;
  }
  return { ...real, buildTree, FileExplorer };
});

pageHooks();

describe("the route", () => {
  theRoute();

  it("keeps text typed while the vault's answer was on its way", async () => {
    const app = await editing();
    // Written and then saved, so the buffer is clean when the event arrives and
    // the read of it goes out. This is the gap the whole mechanism is about.
    app.press("s", { ctrlKey: true });
    await hashed();
    await settle();
    expect(saveNote).toHaveBeenCalledTimes(1);

    let answer: (() => void) | undefined;
    fetchNote.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = () => resolve("somebody else's note");
        }),
    );

    somebodyElseWrote();
    await settle();
    expect(fetchNote).toHaveBeenCalledTimes(2);

    // Typed while that read was in flight, which is the only way a buffer that
    // was clean when the decision was made is dirty when it lands.
    app.press("x");
    answer?.();
    await settle();
    expect(app.text()).toBe("e index note");

    // The quiet save names the reader's own last write as its base, which the
    // vault has moved past.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    await settle();

    expect(app.text()).toBe("e index note");
    expect(app.status()).toBe("Changed on disk");
  });

  it("takes the vault's version on :e!", async () => {
    const app = await editing();
    somebodyElseWrote();
    await settle();
    expect(app.status()).toBe("Changed on disk");

    // The read this answers is the one `:e!` sends. The cache holds neither
    // version by now: the conflict is what stopped the refetch, so what is in
    // there is the text from before the write that caused it.
    fetchNote.mockResolvedValueOnce("somebody else's note");
    app.ex("e!");
    await settle();

    expect(app.text()).toBe("somebody else's note");
    expect(app.status()).toBe("Saved");
    // The other writer's text is what won, so nothing went out.
    expect(saveNote).not.toHaveBeenCalled();
  });

  it("settles a conflict from the status bar, either way, with no key pressed", async () => {
    // What a phone has: no ex prompt, and an editor the tap on the sign blurred.
    const app = await editing();
    somebodyElseWrote();
    await settle();

    // No tap on the sign first: a conflict opens the detail by itself.
    fetchNote.mockResolvedValueOnce("somebody else's text");
    fireEvent.click(screen.getByText("Take the vault's"));
    await settle();

    expect(saveNote).not.toHaveBeenCalled();
    expect(app.text()).toBe("somebody else's text");
    expect(app.status()).toBe("Saved");

    app.press("x");
    somebodyElseWrote();
    await settle();
    fireEvent.click(screen.getByText("Write my text"));
    await settle();

    expect(saveNote).toHaveBeenCalledTimes(1);
    expect(app.status()).toBe("Saved");
  });

  it("does not let a write in flight put back what :e! threw away", async () => {
    const app = await editing();

    // The `PUT` goes out and hangs, which is the window `:e!` has to come
    // through: the read it sends opens a file while this one is writing one and
    // committing it, so the read is the likely one to answer first.
    let written: (() => void) | undefined;
    saveNote.mockImplementationOnce(
      (path: string, content: string) =>
        new Promise((resolve) => {
          written = () => resolve({ path, content });
        }),
    );
    app.ex("w");
    await hashed();
    await settle();
    expect(saveNote).toHaveBeenCalledTimes(1);

    fetchNote.mockResolvedValueOnce("the vault's own text");
    app.ex("e!");
    await settle();
    expect(app.text()).toBe("the vault's own text");

    // The write answers, carrying the text the reader has just discarded. What
    // it must not do is put that text anywhere the editor reads from.
    written?.();
    await settle();

    expect(app.text()).toBe("the vault's own text");
    expect(app.status()).toBe("Saved");
  });

  it("does not keep a failed write's text once :e! has thrown it away", async () => {
    // The same window read the other way. A write that fails holds on to its
    // text so the next keystroke can try again, and after a `:e!` there is no
    // edit left to retry: putting it back would send it to the vault on the
    // next `:w`, which is the loss this command was written to stop.
    const app = await editing();

    let refused: (() => void) | undefined;
    saveNote.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          refused = () => reject(new Error("the vault would not take it"));
        }),
    );
    app.ex("w");
    await hashed();
    await settle();

    fetchNote.mockResolvedValueOnce("the vault's own text");
    app.ex("e!");
    await settle();
    expect(app.text()).toBe("the vault's own text");

    refused?.();
    await settle();

    expect(app.status()).toBe("Saved");
    app.ex("w");
    await settle();
    // The second write is the vault's own text, which `:e!` queues behind the
    // one in the air (#311); `:w` sends nothing more.
    expect(saveNote).toHaveBeenCalledTimes(2);
    expect(saveNote).toHaveBeenLastCalledWith(
      "index.md",
      "the vault's own text",
      false,
      expect.any(String),
    );
  });

  it("reads the bang past a space, and answers no other argument", async () => {
    const app = await editing();

    // A filename is vim's way of opening another note, and this command holds
    // the note its pane holds. So the vault is not read at all: rereading the
    // open note would be the wrong note answering to the right command.
    app.ex("e other.md");
    await settle();
    expect(fetchNote).toHaveBeenCalledTimes(1);
    expect(app.text()).toBe("he index note");

    // The bang survives a trailing space. Losing it there turns the command
    // into the one that declines, and declines without a word.
    app.ex("e! ");
    await settle();
    expect(app.text()).toBe("the index note");
  });

  it("puts the vault's text back on :e! with nobody else writing", async () => {
    // The reader throwing away their own edits, which is what `:e!` is for most
    // of the time. Nothing about the note has changed anywhere, so the query
    // behind it answers with the text it already held and hands the editor
    // nothing new to take: the buffer is put back by the command itself or by
    // nothing at all.
    const app = await editing();

    app.ex("e!");
    await settle();

    expect(app.text()).toBe("the index note");
    expect(app.status()).toBe("Saved");

    // Well past the quiet period, because what was waiting has to be gone
    // rather than merely off the screen.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(saveNote).not.toHaveBeenCalled();
  });

  it("keeps the text and the warning when the vault cannot be read", async () => {
    // The read leads the discard, and this is the whole of why. The other order
    // throws the buffer away on the strength of a request that never lands, and
    // by then the buffer is the only copy of it there is. A note somebody
    // deleted arrives here as the same failure.
    const app = await editing();
    somebodyElseWrote();
    await settle();

    fetchNote.mockRejectedValueOnce(new Error("the vault did not answer"));
    app.ex("e!");
    await settle();

    expect(app.text()).toBe("he index note");
    expect(app.status()).toBe("Changed on disk");
  });

  it("leaves nothing waiting and nothing conflicted behind :e!", async () => {
    const app = await editing();
    somebodyElseWrote();
    await settle();

    fetchNote.mockResolvedValueOnce("somebody else's note");
    app.ex("e!");
    await settle();

    // Nothing waiting: `:w` finds the vault already up to date and sends
    // nothing, rather than sending back the text that was just discarded.
    app.ex("w");
    await settle();
    expect(saveNote).not.toHaveBeenCalled();

    // Nothing conflicted: the keys that were refusing move again. Left set, the
    // note would read `Saved` while every one of them refused for the rest of
    // the session.
    app.leader("c", "t");
    await settle();
    expect(app.tabs()).toBe(2);
  });

  it("refuses :e on a buffer holding unsaved text", async () => {
    // Vim's own rule: `:e` on a modified buffer declines, and only the bang
    // throws the edits away. The vault holds what it always held here, so the
    // only thing a reload could do is take the keystroke off the screen.
    const app = await editing();

    app.ex("e");
    await settle();

    expect(app.text()).toBe("he index note");
    expect(app.status()).toBe("Unsaved changes");
  });

  it("refuses :e while a save is on its way, leaving the screen and the cache alone", async () => {
    // The read `:e` makes fills the cache, and a clean buffer takes what the
    // cache holds: read before the refusal, the vault's older text would land
    // on screen under a write still carrying the newer (#291).
    const app = await editing();
    saveNote.mockImplementationOnce(() => new Promise(() => {}));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    fetchNote.mockClear();

    app.ex("e");
    await settle();

    expect(fetchNote).not.toHaveBeenCalled();
    expect(app.text()).toBe("he index note");
  });
});
