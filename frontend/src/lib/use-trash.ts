import { useQueryClient } from "@tanstack/react-query";
import { type Dispatch, type SetStateAction, useCallback, useMemo } from "react";
import type { TreeCommands } from "@/lib/key-bindings";
import { mapPanes } from "@/lib/pane-contents";
import type { Layout } from "@/lib/panes";
import { deleteFolder, deleteImage, deleteNote, fetchTrash, restoreEntry } from "@/lib/trash-api";

export type Trash = ReturnType<typeof useTrash>;

/** Deletes and restores notes, folders and images, clearing them from screen and caches. */
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
   * Takes a deleted note, or the notes under a deleted folder, off every pane and out of the cache.
   * The cache is dropped, not kept for a restore, since only the vault knows a note's text.
   */
  const discarded = useCallback(
    (gone: string) => {
      // The slash keeps this on a segment boundary: `inboxes/` is not `inbox/`.
      const inside = `${gone}/`;
      const held = (path: string | undefined) =>
        path !== undefined && (path === gone || path.startsWith(inside));

      setLayout((previous) =>
        // History panes too: a restore from one would write the gone note back.
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
   * Moves one note to the trash and off the screen. Nothing asks first: `<leader>du` restores it.
   * Saves first, and a failed save stops only the focused pane's own note.
   */
  const discardNote = useCallback(
    async (startPath?: string) => {
      const path = startPath ?? panePath;
      if (path === undefined) return;
      if (!(await saveFirst()) && path === panePath) return;

      await deleteNote(path).then(
        (entry) => discarded(entry.path),
        // Gone or renamed between the listing and the key; the tree redraws from the next event.
        () => refuse(),
      );
    },
    [panePath, saveFirst, discarded, refuse],
  );

  /**
   * Moves one image to the trash and empties every pane showing it. No save first: an image holds
   * no text to lose. Notes linking it keep their links; `<leader>du` restores it.
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
        // Gone between the listing and the key; the tree redraws from the next event.
        () => refuse(),
      );
    },
    [queryClient, refuse, setLayout],
  );

  /** Moves a folder to the trash in one piece. Saves first, as its open note may be inside. */
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
   * Restores the newest deleted entry, read from the trash so a delete from another tab or a
   * terminal counts too, and opens it if it is a note. A refusal flashes the bar.
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
    // A folder has no note to open, and its notes are already in the tree. A note is a `.md` file.
    if (path.endsWith(".md")) await openInPane(path);
  }, [queryClient, openInPane, refuse]);

  const commands = useMemo<
    Pick<TreeCommands, "deleteNote" | "deleteFolder" | "deleteImage" | "restoreDeleted">
  >(
    () => ({
      // The delete rules live with `discardNote` and `discardFolder`, above.
      deleteNote: (startPath) => void discardNote(startPath),
      deleteFolder: (startPath) => void discardFolder(startPath),
      deleteImage: (startPath) => void discardImage(startPath),
      restoreDeleted: () => void restoreDeleted(),
    }),
    [discardNote, discardFolder, discardImage, restoreDeleted],
  );

  return { discardImage, commands };
}
