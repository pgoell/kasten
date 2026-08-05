import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Editor } from "@/components/editor";
import { FileExplorer } from "@/components/file-explorer";
import { NoteEditor } from "@/components/note-editor";
import { fetchFiles } from "@/lib/api";

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

  return (
    <main className="flex h-dvh bg-one-bg">
      <FileExplorer
        paths={data ?? []}
        openPath={note}
        onOpenFile={(path) => navigate({ search: { note: path } })}
      />
      {/* min-w-0 lets the editor shrink instead of pushing the panel off-screen. */}
      <div className="min-w-0 flex-1">
        {note ? <NoteEditor path={note} /> : <Editor initialDoc={SAMPLE} />}
      </div>
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
