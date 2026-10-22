import { useQueryClient } from "@tanstack/react-query";
import { type Dispatch, type SetStateAction, useCallback, useMemo } from "react";
import type { TreeCommands } from "@/lib/key-bindings";
import { mapPanes } from "@/lib/pane-contents";
import type { Layout } from "@/lib/panes";
import { deleteFolder, deleteImage, deleteNote, fetchTrash, restoreEntry } from "@/lib/trash-api";

export type Trash = ReturnType<typeof useTrash>;

/**
 * Delete and restore: a note, a folder or an image taken off the screen and the
 * caches, and the last deleted entry put back.
 */
export function useTrash({
  panePath,
  setLayout,
  saveFirst,
  refuse,
  openInPane,
}: {
  panePath: string | undefined;
  setLayout: Dispatch<SetStateAction<Layout>>;
  saveFirst: () => Promise<boolean>;
  refuse: () => null;
  openInPane: (path: string, line?: number) => Promise<boolean>;
}) {
  const queryClient = useQueryClient();
  /**
   * Take a deleted note, or a deleted folder's notes, off the screen and the
   * caches.
   *
   * Every pane holding it, not only the focused one: one note is open in
   * several panes at once, and all of them are looking at a file that is no
   * longer there. A folder carries the notes under it, which is why this reads
   * the prefix as well as the path itself.
   *
   * The cached text goes rather than being kept for a restore. The vault is
   * the only thing that knows what is in a note, and a copy left stale by a
   * write outside kasten must not survive the trip through the trash.
   */
  const discarded = useCallback(
    (gone: string) => {
      // The slash keeps this on a segment boundary: `inboxes/` is not `inbox/`.
      const inside = `${gone}/`;
      const held = (path: string | undefined) =>
        path !== undefined && (path === gone || path.startsWith(inside));

      setLayout((previous) =>
        // A history pane too: what it lists is a note the vault no longer has,
        // and a restore from it would write the note back under the reader.
        mapPanes(previous, (shown) =>
          held(shown.path) || held(shown.history) ? { id: shown.id } : shown,
        ),
      );
      queryClient.removeQueries({
        queryKey: ["note"],
        predicate: ({ queryKey }) => typeof queryKey[1] === "string" && held(queryKey[1]),
      });
      void queryClient.invalidateQueries({ queryKey: ["files"] });
    },
    [queryClient, setLayout],
  );

  /**
   * Move one note into the trash, and take it off the screen.
   *
   * Nothing asks first. The note waits in the trash for as long as the backend
   * keeps it and `<leader>du` puts it back, so a mistyped key costs a keypress
   * rather than a note, and a dialog on every delete would cost one every time.
   *
   * Saved first, and the refusal it carries is the pane's own note, which is
   * the rule a rename follows: the tree deletes whatever its cursor sits on,
   * and a note that changed on disk in one pane is no reason to refuse to
   * delete another.
   */
  const discardNote = useCallback(
    async (startPath?: string) => {
      const path = startPath ?? panePath;
      if (path === undefined) return;
      if (!(await saveFirst()) && path === panePath) return;

      await deleteNote(path).then(
        (entry) => discarded(entry.path),
        // The vault has moved past the row: the note went or was renamed
        // between the listing and the key. The tree redraws off the next event.
        () => refuse(),
      );
    },
    [panePath, saveFirst, discarded, refuse],
  );

  /**
   * Move one image into the trash, and take it off the screen.
   *
   * The note's discard read for an image, minus the save: an image holds no text
   * anybody is typing, so there is nothing to write first. Every pane showing it
   * is emptied, the way `discarded` empties the panes holding a deleted note, and
   * for the same reason: what is on screen would otherwise be a picture the vault
   * no longer has.
   *
   * The notes referencing it are left alone, which is what the endpoint says too.
   * They draw a picture that will not load until `<leader>du` puts it back.
   */
  const discardImage = useCallback(
    async (path: string) => {
      await deleteImage(path).then(
        () => {
          setLayout((previous) =>
            mapPanes(previous, (shown) => (shown.image === path ? { id: shown.id } : shown)),
          );
          void queryClient.invalidateQueries({ queryKey: ["images"] });
          // A picture is an asset too, and a link to it is dead now.
          void queryClient.invalidateQueries({ queryKey: ["assets"] });
        },
        // The vault has moved past the row: the image went between the listing
        // and the key. The tree redraws off the next event.
        () => refuse(),
      );
    },
    [queryClient, refuse, setLayout],
  );

  /**
   * The same for a folder, which goes in one piece and comes back in one.
   *
   * Saved first for the reason a folder's rename is: the note in the focused
   * pane may be one of the notes this takes away.
   */
  const discardFolder = useCallback(
    async (startPath: string) => {
      const holdsOpenNote = panePath?.startsWith(`${startPath}/`) ?? false;
      if (!(await saveFirst()) && holdsOpenNote) return;

      await deleteFolder(startPath).then(
        (entry) => discarded(entry.path),
        () => refuse(),
      );
    },
    [panePath, saveFirst, discarded, refuse],
  );

  /**
   * Put the last deleted note or folder back where it was, and open it.
   *
   * The trash is read rather than remembered, so this reaches a delete made in
   * another tab, before a reload, or by hand in a terminal. The newest entry is
   * the first row the backend answers with.
   *
   * A refusal flashes the bar: an empty trash and a path something else has
   * taken since are both a key that did nothing, and the reader has to see that
   * it did nothing.
   */
  const restoreDeleted = useCallback(async () => {
    const newest = await fetchTrash().then(
      (rows) => rows[0],
      () => undefined,
    );
    if (newest === undefined) {
      refuse();
      return;
    }

    const path = await restoreEntry(newest.entry).then(
      (landed) => landed,
      () => null,
    );
    if (path === null) {
      refuse();
      return;
    }

    void queryClient.invalidateQueries({ queryKey: ["files"] });
    // A folder has no note to open, and the notes it brought back are already
    // in the tree by the line above. A note is a `.md` file, which is the
    // vault's own rule for what one is.
    if (path.endsWith(".md")) await openInPane(path);
  }, [queryClient, openInPane, refuse]);

  const commands = useMemo<
    Pick<TreeCommands, "deleteNote" | "deleteFolder" | "deleteImage" | "restoreDeleted">
  >(
    () => ({
      // Both of these carry their own rules, so they are written above rather
      // than here: a delete saves first, empties the panes holding the note and
      // drops what was cached of it.
      deleteNote: (startPath) => void discardNote(startPath),
      deleteFolder: (startPath) => void discardFolder(startPath),
      deleteImage: (startPath) => void discardImage(startPath),
      restoreDeleted: () => void restoreDeleted(),
    }),
    [discardNote, discardFolder, discardImage, restoreDeleted],
  );

  return { discardImage, commands };
}
