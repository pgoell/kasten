import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Editor } from "@/components/editor";
import { FileExplorer } from "@/components/file-explorer";
import { KeyHelp } from "@/components/key-help";
import { NoteEditor } from "@/components/note-editor";
import { editorFollows, NotePrompt, type PromptMode } from "@/components/note-prompt";
import { StatusBar } from "@/components/status-bar";
import { fetchFiles } from "@/lib/api";
import type { EditorCommands } from "@/lib/key-bindings";
import { useAutosave } from "@/lib/use-autosave";

const SAMPLE = `# kasten

Notes are plain markdown files on disk. Postgres holds only a derived index,
so you can always rebuild it from the vault.

Link notes with [[wikilinks]].
`;

interface HomeSearch {
  /** Vault-relative path of the open note, absent while none is open. */
  note?: string;
}

function Home() {
  const { data } = useQuery({ queryKey: ["files"], queryFn: fetchFiles });
  const { note } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
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
  // Raised to ask the tree for the focus. A counter rather than a flag,
  // because asking twice in a row is two requests and has to read as a change.
  const [treeFocus, setTreeFocus] = useState(0);

  const commands = useMemo<EditorCommands>(
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
      // Both, and in one render: a folded panel has no row to focus.
      focusTree: () => {
        setTreeOpen(true);
        setTreeFocus((previous) => previous + 1);
      },
    }),
    [navigate, save, note],
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
              onChange={change}
              onSave={save}
            />
          ) : (
            <Editor initialDoc={SAMPLE} commands={commands} preview={preview} />
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
          onOpen={(path) => {
            const follow = editorFollows(prompt.mode, prompt.startPath, note);
            setPrompt(null);
            if (follow) navigate({ search: { note: path } });
          }}
          onClose={() => setPrompt(null)}
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
  }),
});
