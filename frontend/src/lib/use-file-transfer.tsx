import { useQueryClient } from "@tanstack/react-query";
import {
  type ChangeEvent,
  type Dispatch,
  type SetStateAction,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { type BookBeside, createNote, UPLOAD_LIMIT_BYTES, uploadAsset } from "@/lib/api";
import type { TreeCommands } from "@/lib/key-bindings";
import { whenKeysUp } from "@/lib/last-input";
import { bookNote, encodePath, importedNote, noteName } from "@/lib/note-path";
import type { Pane } from "@/lib/panes";

export type FileTransfer = ReturnType<typeof useFileTransfer>;

/**
 * Hand the browser a file, under a name of our choosing.
 *
 * A click on an anchor nothing renders, which is what a download is when the
 * reader asked for one rather than followed a link. The name carries no
 * folders, because a download names a file and not a path.
 */
function download(name: string, href: string): void {
  const link = document.createElement("a");

  link.href = href;
  link.download = name;
  link.click();
}

/**
 * The open note as a file, under the name the vault gave it.
 *
 * An object URL: the bytes are here already and no request goes out for them.
 * Revoked in the same turn as the click. The browser has read the URL by the
 * time `click` returns, and a URL left alive holds the note's whole text in
 * memory until the tab closes.
 */
function downloadNote(path: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));

  download(`${noteName(path)}.md`, url);
  URL.revokeObjectURL(url);
}

/**
 * A book or a picture, fetched from the address that already serves it.
 *
 * No blob, unlike the note above: these bytes are on disk and not in the page,
 * and asking for them only to wrap them in an object URL would hold a whole
 * epub in memory to save a request the browser is about to make anyway.
 * Encoded the way the image pane spells its `src`: the paths carry spaces, `#`
 * and `?`, and the slashes are real slashes.
 */
function downloadAsset(path: string): void {
  download(path.slice(path.lastIndexOf("/") + 1), `/api/assets/${encodePath(path)}`);
}

/**
 * Every way a file goes in or out of the vault from the keys: the book and
 * markdown pickers, and the download of what the pane is showing.
 */
export function useFileTransfer({
  data,
  pane,
  saveFirst,
  openInPane,
  setNotice,
}: {
  data: string[] | undefined;
  pane: Pick<Pane, "path" | "image" | "book" | "exam">;
  saveFirst: () => Promise<boolean>;
  openInPane: (path: string, line?: number) => Promise<void>;
  setNotice: Dispatch<SetStateAction<string | undefined>>;
}) {
  const queryClient = useQueryClient();
  // The browser's own file picker, which is a hidden input and a click on it.
  const picker = useRef<HTMLInputElement>(null);
  // A second one for markdown. Two inputs rather than one taking both suffixes,
  // because `accept` is what the picker opens on and a single list would show
  // the reader every epub in the folder they came to find a note in.
  const notePicker = useRef<HTMLInputElement>(null);

  /**
   * Put the file the picker just handed back into the vault, with its note.
   *
   * The book keeps its own name and lands in the inbox, rather than taking the
   * name of whatever note was in the pane: that threw the title away and
   * pinned the book to a note about something else. The note beside it is
   * what makes it readable at all, the pair being a convention rather than a
   * record, and opening it is the only thing on screen that says the upload
   * worked.
   *
   * The book goes up before the note is made, so a refusal leaves no orphan
   * note behind.
   */
  const chooseBook = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file === undefined) return;

      const filed = bookNote(file.name);
      if (filed === null) {
        setNotice("The vault will not take that name");
        return;
      }

      // Checked here rather than left to the backend, which would refuse the
      // upload when it opens, before a piece goes: this names the limit
      // without the round trip, and the backend's 413 is the backstop.
      if (file.size > UPLOAD_LIMIT_BYTES) {
        setNotice("That file is over the 1 GiB upload limit");
        return;
      }

      try {
        await uploadAsset(filed.book, file);
      } catch (error: unknown) {
        // A typed `unknown` and not an untyped catch. A `fetch` rejects with
        // no response at all on a dropped connection or a suspended tab, and
        // there is no status to name, so the last arm is a sentence.
        setNotice(error instanceof Error ? error.message : "The upload failed");
        return;
      }

      // The `listing` event the upload fires invalidates `["files"]` alone, so
      // a reader already sitting on "no sidecar" would never notice this one.
      // Keyed on the note, which is what the reader asks the vault about.
      void queryClient.invalidateQueries({ queryKey: ["book", filed.note] });

      const made = (data ?? []).includes(filed.note)
        ? null
        : await createNote(filed.note, `# ${filed.name}\n`);
      if (made !== null) {
        queryClient.setQueryData(["note", made.path], made.content);
        void queryClient.invalidateQueries({ queryKey: ["files"] });
      }

      await openInPane(made?.path ?? filed.note);
    },
    [data, queryClient, openInPane, setNotice],
  );

  /**
   * Put every markdown file the picker handed back into the inbox.
   *
   * One file at a time, each create awaited before the next goes out, rather
   * than a batch of them in flight together: every create takes its own jj
   * change, and several racing the repo would leave changes naming notes they
   * did not write.
   *
   * Nothing is overwritten. A name the inbox already holds comes back as a
   * refusal from the create, which stops that one file and none of the others.
   * An import that quietly replaced a note would be the only command in this
   * app that loses text, and the file is still on disk to be renamed and
   * picked again.
   *
   * The first file that lands opens in the focused pane, which is the only
   * thing on screen that says the import worked. What the rest of them are
   * called is the tree's to show.
   */
  const chooseNotes = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      let first: string | undefined;
      let refused: string | undefined;

      for (const file of [...(event.target.files ?? [])]) {
        const path = importedNote(file.name);
        if (path === null) {
          refused ??= "The vault will not take that name";
          continue;
        }

        try {
          const made = await createNote(path, await file.text());
          queryClient.setQueryData(["note", made.path], made.content);
          first ??= made.path;
        } catch (error: unknown) {
          // A typed `unknown` for the reason the book's upload takes one: a
          // `fetch` that never reached the backend rejects with no status to
          // name. The first refusal is the sentence the bar carries, and the
          // rest of the batch still goes in behind it.
          refused ??= error instanceof Error ? error.message : "The import failed";
        }
      }

      if (refused !== undefined) setNotice(refused);
      if (first === undefined) return;

      void queryClient.invalidateQueries({ queryKey: ["files"] });
      await openInPane(first);
    },
    [queryClient, openInPane, setNotice],
  );

  const commands = useMemo<Pick<TreeCommands, "uploadBook" | "importNotes" | "exportNote">>(
    () => ({
      // Needs no note in the pane: the book keeps its own name and brings its
      // own note, so there is nothing here to be beside.
      uploadBook: () => {
        const input = picker.current;
        if (input === null) return;

        setNotice(undefined);
        // Blanked before the click. An input keeps the file you last chose and
        // choosing the same one again may fire no `change` at all, which is
        // the retry after a failed upload silently doing nothing.
        input.value = "";
        // Nothing awaited in front of the click. A file picker needs transient
        // user activation and an `await` gives the browser a turn in which it
        // expires. The click waits only for the key to come up, which stays
        // inside the activation window, so the picker opens and the pointer
        // is back (#692). jsdom models none of that, so an `await` here
        // passes every test in this repo and opens nothing on the box.
        whenKeysUp(() => input.click());
      },
      // The same picker, one input over, and the same reason for needing no
      // note in the pane: the files bring their own names.
      importNotes: () => {
        const input = notePicker.current;
        if (input === null) return;

        setNotice(undefined);
        input.value = "";
        whenKeysUp(() => input.click());
      },
      // Whatever the pane is holding, not the note alone: a picture and a book
      // are files the vault has and the reader is looking at, and a key called
      // "download this" that answers only in one pane out of four is a key the
      // reader has to remember the shape of.
      //
      // The two assets go out untouched and unsaved, nothing here having edited
      // them. The note is saved first the way `showLinksOut` is, and it reads
      // the text back out of the same cache: a file holding the note as it
      // stood before the last keystroke says something the note does not. A
      // write that was refused still downloads, on the older text, because the
      // copy in hand is worth more than the one that was not taken.
      exportNote: async () => {
        if (pane.image !== undefined) {
          downloadAsset(pane.image);
          return;
        }
        if (pane.book !== undefined) {
          // Out of the cache the reader filled, because the pane's own field
          // is the note and only the vault knows which file is beside it. A
          // reader whose fetch has not landed has nothing to download, and a
          // reader showing "nothing to read beside" is that same case.
          const beside = queryClient.getQueryData<BookBeside>(["book", pane.book]);
          if (beside !== undefined) downloadAsset(beside.path);
          return;
        }

        // The exam beside the note: the pane holds the note's path and the
        // cache holds its text under the same key, an exam being a way of
        // reading a note rather than a file of its own.
        const note = pane.path ?? pane.exam;
        if (note === undefined) return;

        await saveFirst();
        downloadNote(note, queryClient.getQueryData<string>(["note", note]) ?? "");
      },
    }),
    [pane.image, pane.book, pane.path, pane.exam, saveFirst, queryClient, setNotice],
  );

  const element = (
    <>
      {/* Last in the markup and always mounted, so `<leader>cb` has something
          to click and no open prompt has this in front of its own input.
          `accept` filters the picker's default view and stops nothing, the
          user being free to switch it to all files, which is why the backend
          looks at the bytes. */}
      <input
        ref={picker}
        type="file"
        accept=".epub,.pdf,application/epub+zip,application/pdf"
        className="hidden"
        onChange={chooseBook}
      />
      {/* The same again for `<leader>cm`, which takes any number of them. */}
      <input
        ref={notePicker}
        type="file"
        accept=".md,text/markdown"
        multiple
        className="hidden"
        onChange={chooseNotes}
      />
    </>
  );

  return { commands, element };
}
