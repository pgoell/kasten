import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { Editor } from "@/components/editor";
import { FileExplorer } from "@/components/file-explorer";
import { KeyHelp } from "@/components/key-help";
import { NoteEditor } from "@/components/note-editor";
import { NoteFinder } from "@/components/note-finder";
import { NotePrompt, noteAfterPrompt, type PromptMode } from "@/components/note-prompt";
import { NoteSearch } from "@/components/note-search";
import { StatusBar } from "@/components/status-bar";
import { createNote, fetchFiles } from "@/lib/api";
import type { TreeCommands } from "@/lib/key-bindings";
import { useAutosave } from "@/lib/use-autosave";
import { wikiLinkPath } from "@/lib/wikilink";

const SAMPLE = `# kasten

Notes are plain markdown files on disk. Postgres holds only a derived index,
so you can always rebuild it from the vault.

Link notes with [[wikilinks]].
`;

interface HomeSearch {
  /** Vault-relative path of the open note, absent while none is open. */
  note?: string;
  /**
   * Line the editor opens on, which only a search hit names.
   *
   * In the URL beside the note so a reload lands back on the match rather than
   * at the top of the note, the way `note` itself survives one.
   */
  line?: number;
}

function Home() {
  const { data } = useQuery({ queryKey: ["files"], queryFn: fetchFiles });
  const { note, line } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  // Autosave sits out here rather than in the editor because it has to outlive
  // the remount that opening another note causes: text typed into one note is
  // written to it while the next note is already opening.
  const { status, change, save } = useAutosave(note);
  // Chrome the leader keys reach. It lives up here rather than in the panel
  // because the key that toggles it is pressed inside the editor.
  const [treeOpen, setTreeOpen] = useState(true);
  // Above the remount that opening another note causes, so turning the
  // rendering off stays off until you turn it back on.
  const [preview, setPreview] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  // What the prompt is doing and where it starts, and null while it is closed.
  // One piece of state for both, because a create opening on the vault root
  // starts at "" and that still has to read as open.
  const [prompt, setPrompt] = useState<{ mode: PromptMode; startPath: string } | null>(null);
  // A flag and not a path, unlike the prompt: the finder ranks the whole vault
  // and has nothing to start from.
  const [finderOpen, setFinderOpen] = useState(false);
  // Its own flag rather than a mode of the finder's: that one ranks a vault
  // already in hand, this one asks the backend on a delay, and the two share
  // no state worth folding together.
  const [searchOpen, setSearchOpen] = useState(false);
  // Raised to ask the tree for the focus. A counter rather than a flag,
  // because asking twice in a row is two requests and has to read as a change.
  const [treeFocus, setTreeFocus] = useState(0);

  const commands = useMemo<TreeCommands>(
    () => ({
      toggleTree: () => setTreeOpen((previous) => !previous),
      togglePreview: () => setPreview((previous) => !previous),
      // Only leave once the vault has the text. A failed write keeps the note
      // on screen with the warning already in the status bar, because closing
      // unmounts the editor and the only copy of the edit goes with it.
      closeNote: async () => {
        if (await save()) navigate({ search: {} });
      },
      showHelp: () => setHelpOpen(true),
      createNote: (startPath = "") => setPrompt({ mode: "create", startPath }),
      // Save before the prompt opens, not after Enter. `useAutosave` flushes
      // pending text when its path changes, using the render's own closure, so
      // text still waiting when the note moves would be written to a path the
      // vault no longer has. Nothing can be typed into the editor once the
      // modal holds the focus, so flushing here is enough. A failed write keeps
      // the prompt shut with the warning already in the status bar, the way
      // `closeNote` refuses to leave.
      renameNote: async (startPath) => {
        const path = startPath ?? note;
        if (path === undefined) return;
        if (await save()) setPrompt({ mode: "rename", startPath: path });
      },
      // Saved first for the reason a note's rename is: the open note may be one
      // of the notes this moves, and text still waiting would be written to a
      // path the vault no longer has.
      renameFolder: async (startPath) => {
        if (await save()) setPrompt({ mode: "folder", startPath });
      },
      // No save first, unlike the two renames. They move a path out from under
      // text still waiting to be written; opening a note leaves every path
      // where it is, and `useAutosave` flushes on its own when the path it was
      // given changes.
      findNote: () => setFinderOpen(true),
      // No save first, for the reason the finder needs none: searching moves
      // no path out from under text still waiting to be written.
      searchNotes: () => setSearchOpen(true),
      // Both, and in one render: a folded panel has no row to focus.
      focusTree: () => {
        setTreeOpen(true);
        setTreeFocus((previous) => previous + 1);
      },
    }),
    [navigate, save, note],
  );

  /**
   * Open the note a `[[link]]` names, making it if the vault has none.
   *
   * The listing is what turns a name into a path, so the resolving happens
   * here rather than in the editor, which holds one note and knows nothing of
   * the others. A link to a note that is not there is not a mistake: writing
   * the link before the note is how a vault grows, and following one is the
   * moment the note begins. No save first, for the reason the finder needs
   * none: this moves no path out from under text still waiting to be written.
   */
  const follow = useCallback(
    (target: string) => {
      const paths = data ?? [];
      const path = wikiLinkPath(target, paths);
      if (paths.includes(path)) {
        navigate({ search: { note: path } });
        return;
      }

      void createNote(path).then(
        (made) => {
          // The vault's spelling and the vault's text, the way the prompt
          // seeds them, so the editor opens what was written rather than
          // reading back a file it just made.
          queryClient.setQueryData(["note", made.path], made.content);
          queryClient.invalidateQueries({ queryKey: ["files"] });
          navigate({ search: { note: made.path } });
        },
        () => {
          // The vault refused the path: a hidden name, or a note standing
          // where the link wanted a folder. The note on screen stays open with
          // the link still in it, which is the only place to fix either.
        },
      );
    },
    [data, navigate, queryClient],
  );

  return (
    <main className="flex h-dvh flex-col bg-one-bg">
      {/* min-h-0 lets the editor scroll instead of pushing the bar off-screen. */}
      <div className="flex min-h-0 flex-1">
        <FileExplorer
          paths={data ?? []}
          openPath={note}
          onOpenFile={(path) => navigate({ search: { note: path } })}
          open={treeOpen}
          onOpenChange={setTreeOpen}
          commands={commands}
          focusSignal={treeFocus}
        />
        {/* min-w-0 lets the editor shrink instead of pushing the panel off-screen. */}
        <div className="min-w-0 flex-1">
          {note ? (
            <NoteEditor
              path={note}
              commands={commands}
              preview={preview}
              paths={data}
              startLine={line}
              onChange={change}
              onSave={save}
              onFollow={follow}
            />
          ) : (
            <Editor
              initialDoc={SAMPLE}
              commands={commands}
              preview={preview}
              paths={data}
              onFollow={follow}
            />
          )}
        </div>
      </div>
      <StatusBar status={note ? status : undefined} />
      {helpOpen && <KeyHelp onClose={() => setHelpOpen(false)} />}
      {prompt !== null && (
        <NotePrompt
          mode={prompt.mode}
          paths={data ?? []}
          startPath={prompt.startPath}
          openNote={note}
          onOpen={(path) => {
            const next = noteAfterPrompt(prompt.mode, prompt.startPath, path, note);
            setPrompt(null);
            if (next !== undefined) navigate({ search: { note: next } });
          }}
          onClose={() => setPrompt(null)}
        />
      )}
      {finderOpen && (
        <NoteFinder
          paths={data ?? []}
          onOpen={(path) => {
            setFinderOpen(false);
            // No line: the finder opens a note, not a place in one, and a
            // stale `line` left in the URL would drop the cursor somewhere
            // the previous search happened to point at.
            navigate({ search: { note: path } });
          }}
          onClose={() => setFinderOpen(false)}
        />
      )}
      {searchOpen && (
        <NoteSearch
          onOpen={(path, hitLine) => {
            setSearchOpen(false);
            navigate({ search: { note: path, line: hitLine } });
          }}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </main>
  );
}

export const Route = createFileRoute("/")({
  component: Home,
  // The open note lives in the URL, so a reload and the back button both keep
  // their place. Anything that is not a string reads as no note open.
  validateSearch: (search: Record<string, unknown>): HomeSearch => ({
    note: typeof search.note === "string" ? search.note : undefined,
    // Anything that is not a line number reads as no line, which covers a
    // hand-typed URL as well as the absence of one.
    line:
      Number.isInteger(Number(search.line)) && Number(search.line) > 0
        ? Number(search.line)
        : undefined,
  }),
});
