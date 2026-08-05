import { useQuery } from "@tanstack/react-query";
import { Editor } from "@/components/editor";
import { fetchNote } from "@/lib/api";
import { type SaveStatus, useAutosave } from "@/lib/use-autosave";

interface NoteEditorProps {
  /** Vault-relative path of the note to open. */
  path: string;
}

const MESSAGE = "flex h-full items-center justify-center px-4 text-sm text-one-muted";

const SAVE_LABEL: Record<SaveStatus, string> = {
  saved: "Saved",
  unsaved: "Unsaved changes",
  saving: "Saving",
  error: "Could not save",
};

/**
 * One note from the vault, open in the editor.
 *
 * The `key` is what makes opening a second note replace the first one's text.
 * The editor reads its document once, on mount, and a note that is already in
 * the cache arrives with no loading gap to remount across.
 *
 * Autosave sits out here rather than inside the editor because it has to
 * outlive that remount: text typed into one note is written to it while the
 * next note is already opening.
 */
export function NoteEditor({ path }: NoteEditorProps) {
  const { data, error, isPending } = useQuery({
    queryKey: ["note", path],
    queryFn: () => fetchNote(path),
  });
  const { status, change, save } = useAutosave(path);

  if (isPending) return <p className={MESSAGE}>Opening {path}</p>;
  if (error) return <p className={MESSAGE}>Could not open {path}</p>;

  return (
    <div className="flex h-full flex-col">
      {/* min-h-0 lets the editor scroll instead of pushing the bar off-screen. */}
      <div className="min-h-0 flex-1">
        <Editor key={path} initialDoc={data} onChange={change} onSave={save} />
      </div>
      <p
        data-testid="save-status"
        className={`border-t border-one-line bg-one-panel px-3 py-1 text-xs ${
          status === "error" ? "text-one-accent" : "text-one-muted"
        }`}
      >
        {SAVE_LABEL[status]}
      </p>
    </div>
  );
}
