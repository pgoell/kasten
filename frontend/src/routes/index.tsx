import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Editor } from "@/components/editor";
import { FileExplorer } from "@/components/file-explorer";
import { fetchFiles } from "@/lib/api";

const SAMPLE = `# kasten

Notes are plain markdown files on disk. Postgres holds only a derived index,
so you can always rebuild it from the vault.

Link notes with [[wikilinks]].
`;

function Home() {
  const { data } = useQuery({ queryKey: ["files"], queryFn: fetchFiles });

  return (
    <main className="flex h-dvh bg-one-bg">
      <FileExplorer paths={data ?? []} />
      {/* min-w-0 lets the editor shrink instead of pushing the panel off-screen. */}
      <div className="min-w-0 flex-1">
        <Editor initialDoc={SAMPLE} />
      </div>
    </main>
  );
}

export const Route = createFileRoute("/")({ component: Home });
