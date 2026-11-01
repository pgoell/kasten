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
 * Hands the browser a file by clicking an unrendered anchor. The name is a file name,
 * not a path, so it carries no folders.
 */
function download(name: string, href: string): void {
  const link = document.createElement("a");

  link.href = href;
  link.download = name;
  link.click();
}

/**
 * The open note as a file. The URL is revoked in the same turn: a live one holds the
 * note's text in memory until the tab closes.
 */
function downloadNote(path: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));

  download(`${noteName(path)}.md`, url);
  URL.revokeObjectURL(url);
}

/**
 * A book or picture, fetched from the address that serves it. No blob: that would hold a
 * whole epub in memory for a request the browser makes anyway.
 */
function downloadAsset(path: string): void {
  download(path.slice(path.lastIndexOf("/") + 1), `/api/assets/${encodePath(path)}`);
}

/** Sends a book up: null once it is there, else what to tell the user. */
async function upload(path: string, file: File): Promise<string | null> {
  try {
    await uploadAsset(path, file);
    return null;
  } catch (error: unknown) {
    // Typed unknown: a fetch that never gets a response has no status to name.
    return error instanceof Error ? error.message : "The upload failed";
  }
}

/** Creates one picked markdown file in the inbox, never over a note: the note made, or why not. */
async function importNote(
  file: File,
): Promise<{ path: string; content: string } | { refused: string }> {
  const path = importedNote(file.name);
  if (path === null) return { refused: "The vault will not take that name" };
  try {
    return await createNote(path, await file.text());
  } catch (error: unknown) {
    // Typed unknown, as in the upload.
    return { refused: error instanceof Error ? error.message : "The import failed" };
  }
}

/** Every file moved in or out of the vault from the keys: the pickers and the download. */
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
  openInPane: (path: string, line?: number) => Promise<boolean>;
  setNotice: Dispatch<SetStateAction<string | undefined>>;
}) {
  const queryClient = useQueryClient();
  const picker = useRef<HTMLInputElement>(null);
  // Two inputs, not one: accept filters the picker's view, so one list would show every epub too.
  const notePicker = useRef<HTMLInputElement>(null);

  /**
   * Uploads the picked book into the inbox under its own name, beside the note that makes it
   * readable. The book goes up first, so a refusal leaves no orphan note.
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

      // Checked here to name the limit without a round trip; the backend's 413 is the backstop.
      if (file.size > UPLOAD_LIMIT_BYTES) {
        setNotice("That file is over the 1 GiB upload limit");
        return;
      }

      const refused = await upload(filed.book, file);
      if (refused !== null) {
        setNotice(refused);
        return;
      }

      // The listing event does not refresh the book query, so invalidate it here.
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
   * Puts each picked markdown file into the inbox, one at a time: every create takes its own
   * jj change. Never overwrites; the first file to land opens in the focused pane.
   */
  const chooseNotes = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      let first: string | undefined;
      let refused: string | undefined;

      for (const file of [...(event.target.files ?? [])]) {
        const made = await importNote(file);
        if ("refused" in made) {
          // Only the first refusal is shown; the batch goes on.
          refused ??= made.refused;
          continue;
        }
        queryClient.setQueryData(["note", made.path], made.content);
        first ??= made.path;
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
      // Needs no note in the pane: the book brings its own note.
      uploadBook: () => {
        const input = picker.current;
        if (input === null) return;

        setNotice(undefined);
        // Blanked so choosing the same file again still fires change: a retry after a failure.
        input.value = "";
        // No await before the click: the picker needs user activation, which an await
        // lets expire (#692). jsdom does not model this, so tests cannot catch it.
        whenKeysUp(() => input.click());
      },
      // Same as uploadBook, for the markdown input. The files bring their own names.
      importNotes: () => {
        const input = notePicker.current;
        if (input === null) return;

        setNotice(undefined);
        input.value = "";
        whenKeysUp(() => input.click());
      },
      // Downloads whatever the pane holds, not just a note. The note is saved first and read
      // from the cache; if the save is refused, the older text still downloads.
      exportNote: async () => {
        if (pane.image !== undefined) {
          downloadAsset(pane.image);
          return;
        }
        if (pane.book !== undefined) {
          // Only the vault knows the file beside the note, so it comes from the cache.
          const beside = queryClient.getQueryData<BookBeside>(["book", pane.book]);
          if (beside !== undefined) downloadAsset(beside.path);
          return;
        }

        // An exam is a way of reading the note, so it shares the note's cache key.
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
      {/* Always mounted, so `<leader>cb` has something to click. `accept` only filters the
          default view, so the backend checks the bytes. */}
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
