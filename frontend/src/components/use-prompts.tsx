import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Dispatch, type SetStateAction, useCallback, useMemo, useState } from "react";
import { ClipPrompt } from "@/components/clip-prompt";
import { DumpPrompt } from "@/components/dump-prompt";
import { MoveConfirm } from "@/components/move-confirm";
import { NotePrompt, noteAfterPrompt, type PromptMode } from "@/components/note-prompt";
import { TerminalPrompt } from "@/components/terminal-prompt";
import { TodoPrompt } from "@/components/todo-prompt";
import type { PaneMoves } from "@/components/use-pane-moves";
import { fetchTerminals, type SearchHit } from "@/lib/api";
import { importPage } from "@/lib/clip";
import { readClock } from "@/lib/clock";
import { moveHeld } from "@/lib/held-text";
import type { TreeCommands } from "@/lib/key-bindings";
import type { MoveMode } from "@/lib/move";
// Renamed because the route that calls this already has a `flush`, the bookmark's.
import { flush as flushOutbox, keep } from "@/lib/outbox";
import { mapPanes, openInFocused, openTerminalInFocused } from "@/lib/pane-contents";
import type { Layout } from "@/lib/panes";
import { parseTodo } from "@/lib/todo/todo";
import { addTodoInVault } from "@/lib/todo/todo-api";
import { addSubtaskInVault } from "@/lib/todo/todo-line-edits";

export type Prompts = ReturnType<typeof usePrompts>;

/** What a list prop gets while its query loads, for the reason the route's copy gives. */
const LOADING: string[] = [];

/**
 * Every prompt the route opens over the window, and what each one does with
 * what it is handed: a new note or rename, a move, a terminal, a clip, a todo
 * and a dump.
 */
export function usePrompts({
  data,
  panePath,
  narrow,
  setLayout,
  saveFirst,
  moves,
  openInPane,
  todosWritten,
  setNotice,
}: {
  data: string[] | undefined;
  panePath: string | undefined;
  narrow: boolean;
  setLayout: Dispatch<SetStateAction<Layout>>;
  saveFirst: () => Promise<boolean>;
  moves: Pick<PaneMoves, "moveTo" | "refocusPane">;
  openInPane: (path: string, line?: number) => Promise<boolean>;
  todosWritten: () => void;
  setNotice: Dispatch<SetStateAction<string | undefined>>;
}) {
  const { moveTo, refocusPane } = moves;
  const queryClient = useQueryClient();
  // One state for both: a create on the vault root starts at "" and still reads as open.
  const [prompt, setPrompt] = useState<{ mode: PromptMode; startPath: string } | null>(null);
  const [moving, setMoving] = useState<{
    mode: MoveMode;
    startPath: string;
    target: string;
  } | null>(null);
  const [terminalPrompt, setTerminalPrompt] = useState(false);
  // Typed, not picked, so there is nothing to open it on.
  const [clipPrompt, setClipPrompt] = useState(false);
  // The row `s` opened on, which decides which note the typed todo lands in.
  const [todoPrompt, setTodoPrompt] = useState<{ parent?: SearchHit } | null>(null);
  const [dumpPrompt, setDumpPrompt] = useState(false);
  // Asked for only while open: the sessions change outside the browser, and nothing else reads them.
  const { data: terminals } = useQuery({
    queryKey: ["terminals"],
    queryFn: fetchTerminals,
    enabled: terminalPrompt,
  });

  /**
   * Read a web page into the inbox, then open the note it became. Nothing is caught:
   * the prompt shows what throws, so the reader sees the address that failed.
   */
  const clip = useCallback(
    async (url: string) => {
      const { path, made } = await importPage(url, data ?? []);

      if (made !== null) {
        queryClient.setQueryData(["note", made.path], made.content);
        void queryClient.invalidateQueries({ queryKey: ["files"] });
      }

      setClipPrompt(false);
      await openInPane(path);
    },
    [data, queryClient, openInPane],
  );

  /** Point every pane at where a move put its note, in every tab: one note can sit in several panes. */
  const followMove = useCallback(
    (mode: MoveMode, startPath: string, path: string) => {
      // Held text is kept by path, so it moves with the note or the bar lists a note that is gone.
      moveHeld((held) => noteAfterPrompt(mode, startPath, path, held));
      setLayout((previous) =>
        mapPanes(previous, (shown) => {
          const next = noteAfterPrompt(mode, startPath, path, shown.path);
          // A move carries the note's book and history along, so they follow the note.
          // The vault leaves a book behind when its new sidecar path is taken; the reader shows "No book at ...".
          const book = noteAfterPrompt(mode, startPath, path, shown.book) ?? shown.book;
          const history = noteAfterPrompt(mode, startPath, path, shown.history) ?? shown.history;
          const moved = next === undefined ? shown : { ...shown, path: next };
          const read = book === shown.book ? moved : { ...moved, book };
          return history === shown.history ? read : { ...read, history };
        }),
      );
    },
    [setLayout],
  );

  /**
   * Write the typed todo under `## TODOs` in today's note, from pane `a` or beside row `s`.
   * The clock is read here, so a prompt left open over midnight writes the day it was taken on.
   */
  const addTodo = useCallback(
    (input: string) => {
      const parent = todoPrompt?.parent;
      setTodoPrompt(null);
      refocusPane();
      const today = readClock(new Date()).date;
      const written =
        parent === undefined
          ? addTodoInVault(input, today, data ?? [])
          : addSubtaskInVault(parent, input, today);
      void written.then(todosWritten, () => {
        // The vault refused the write, or the note moved out from under the
        // row. Nothing on screen moved with it, so there is nothing to put back.
      });
    },
    [data, todosWritten, refocusPane, todoPrompt],
  );

  /**
   * Put a typed thought in the `## Dump` of today's note. The day is read here, as in `addTodo`.
   */
  const capture = useCallback(
    (text: string) => {
      setDumpPrompt(false);
      void keep(text, readClock(new Date()).date).then(
        async (dump) => {
          // A pass that began after the keep, so its answer is about this dump.
          const { waiting, failure } = await flushOutbox();
          const mine = waiting.find((each) => each.id === dump.id);
          if (mine === undefined) setNotice("Captured into today's dump");
          else if (mine.refused !== undefined) setNotice(mine.refused);
          else if (failure?.kind === "sign-in")
            setNotice("Captured, waiting to send: sign in again");
          else setNotice(`Captured, waiting to send (${waiting.length} waiting)`);
        },
        (error: unknown) =>
          setNotice(error instanceof Error ? error.message : "The capture was not kept"),
      );
    },
    [setNotice],
  );

  const openTodoPrompt = useCallback(
    (parent?: SearchHit) => setTodoPrompt(parent === undefined ? {} : { parent }),
    [],
  );

  const commands = useMemo<
    Pick<
      TreeCommands,
      | "createNote"
      | "renameNote"
      | "renameFolder"
      | "moveRow"
      | "openTerminal"
      | "importPage"
      | "captureDump"
    >
  >(
    () => ({
      // Saved first the way a rename is, and for the same reason: the note a
      // create makes is opened in the focused pane, which moves the autosave's
      // path out from under text still waiting for the note being left.
      createNote: async (startPath = "") => {
        if (await saveFirst()) setPrompt({ mode: "create", startPath });
      },
      // Save before the prompt opens, not after Enter. `useAutosave` flushes
      // pending text when its path changes, using the render's own closure, so
      // text still waiting when the note moves would be written to a path the
      // vault no longer has. Nothing can be typed into a pane once the modal
      // holds the focus, so flushing here is enough. A failed write keeps the
      // prompt shut with the warning already in the status bar, the way
      // `closeNote` refuses to leave.
      //
      // The refusal it carries is the pane's own note and nothing else. The
      // tree renames whatever its cursor sits on, which is usually not what is
      // open, and a note that changed on disk in one pane is no reason to
      // refuse to move a note somewhere else in the vault.
      renameNote: async (startPath) => {
        const path = startPath ?? panePath;
        if (path === undefined) return;
        if (!(await saveFirst()) && path === panePath) return;
        setPrompt({ mode: "rename", startPath: path });
      },
      // Saved first for the reason both renames are, and narrowed the way
      // each of them is.
      renameFolder: async (startPath) => {
        // Narrowed the way the note's rename is: only a folder the open note
        // sits under can move that note's path.
        const holdsOpenNote = panePath?.startsWith(`${startPath}/`) ?? false;
        if (!(await saveFirst()) && holdsOpenNote) return;
        setPrompt({ mode: "folder", startPath });
      },
      // Saved first for the reason both renames are, and narrowed the way
      // each of them is.
      moveRow: async (startPath, mode, target) => {
        const holdsOpenNote =
          mode === "folder"
            ? (panePath?.startsWith(`${startPath}/`) ?? false)
            : panePath === startPath;
        if (!(await saveFirst()) && holdsOpenNote) return;
        setMoving({ mode, startPath, target });
      },
      // No save first: opening the prompt moves no path. Naming a session does
      // replace what is in the pane, and that is asked on the way out below.
      openTerminal: () => setTerminalPrompt(true),
      // No save first, for the reason the terminal's prompt needs none: opening
      // it moves no path. The note it makes is opened through `openInPane`,
      // which asks.
      importPage: () => setClipPrompt(true),
      // The press clears the last notice, so the one this leaves behind is
      // about this capture and not an earlier one.
      captureDump: () => {
        setNotice(undefined);
        setDumpPrompt(true);
      },
    }),
    [saveFirst, panePath, setNotice],
  );

  const element = (
    <>
      {clipPrompt && (
        <ClipPrompt
          onClip={clip}
          onClose={() => {
            setClipPrompt(false);
            refocusPane();
          }}
        />
      )}
      {terminalPrompt && (
        <TerminalPrompt
          sessions={terminals ?? LOADING}
          onOpen={(session) => {
            setTerminalPrompt(false);
            // Through `moveTo` rather than `setLayout`, so opening a terminal
            // is refused while the note in the focused pane stands conflicted,
            // the same as every other key that moves the focus. The refusal
            // sits on the path that replaces the pane rather than on the key
            // that opens the prompt, which replaces nothing.
            moveTo((previous) => openTerminalInFocused(previous, session));
          }}
          onClose={() => setTerminalPrompt(false)}
        />
      )}
      {dumpPrompt && (
        <DumpPrompt
          onCapture={capture}
          onClose={() => setDumpPrompt(false)}
          today={readClock(new Date()).date}
        />
      )}
      {todoPrompt !== null && (
        <TodoPrompt
          onAdd={addTodo}
          onClose={() => {
            setTodoPrompt(null);
            refocusPane();
          }}
          // The line as the vault holds it, read no further than this: the
          // prompt draws it to say where the part is going, and the write reads
          // the note again for itself.
          under={
            todoPrompt.parent === undefined
              ? undefined
              : (parseTodo(todoPrompt.parent.text)?.text ?? todoPrompt.parent.text)
          }
          // Read at the render, the way the pane reads it, so the line the
          // prompt draws and the line the write makes are the same day's.
          today={readClock(new Date()).date}
        />
      )}
      {prompt !== null && (
        <NotePrompt
          mode={prompt.mode}
          paths={data ?? LOADING}
          startPath={prompt.startPath}
          openNote={panePath}
          onOpen={(path) => {
            const { mode, startPath } = prompt;
            setPrompt(null);
            if (mode === "create") {
              setLayout((previous) => openInFocused(previous, path));
              // The prompt hands the focus back to the tree it was opened
              // from, which on a narrow window is a drawer over the new note.
              if (narrow) refocusPane();
            } else followMove(mode, startPath, path);
          }}
          onClose={() => setPrompt(null)}
        />
      )}
      {moving !== null && (
        <MoveConfirm
          mode={moving.mode}
          startPath={moving.startPath}
          target={moving.target}
          onMoved={(path) => {
            setMoving(null);
            followMove(moving.mode, moving.startPath, path);
          }}
          onClose={() => setMoving(null)}
        />
      )}
    </>
  );

  return { commands, openTodoPrompt, element };
}
