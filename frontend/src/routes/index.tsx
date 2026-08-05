import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Editor } from "@/components/editor";
import { FileExplorer } from "@/components/file-explorer";
import { KeyHelp } from "@/components/key-help";
import { NoteEditor } from "@/components/note-editor";
import { NotePrompt } from "@/components/note-prompt";
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
  // The folder the prompt opens on, and null while it is closed. The folder is
  // part of the request, so an empty string still means open.
  const [promptStart, setPromptStart] = useState<string | null>(null);
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
      createNote: (startPath = "") => setPromptStart(startPath),
      // Both, and in one render: a folded panel has no row to focus.
      focusTree: () => {
        setTreeOpen(true);
        setTreeFocus((previous) => previous + 1);
      },
    }),
    [navigate, save],
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
      {promptStart !== null && (
        <NotePrompt
          paths={data ?? []}
          startPath={promptStart}
          onOpen={(path) => {
            setPromptStart(null);
            navigate({ search: { note: path } });
          }}
          onClose={() => setPromptStart(null)}
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
