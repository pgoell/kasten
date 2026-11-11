import { isNotePath } from "@/lib/graph/graph";
import type { Graph } from "@/lib/graph/graph-api";
import { noteName } from "@/lib/notes/links/note-path";

/** A pattern's rows, under the canvas, with each note path a button that opens it. */
export function GraphRows({
  columns,
  rows,
  truncated,
  onOpen,
}: {
  columns: Graph["columns"];
  rows: Graph["rows"];
  truncated: boolean;
  onOpen: (path: string) => void;
}) {
  return (
    <div className="max-h-[40%] overflow-auto border-t border-k-rule">
      <table className="w-full text-left text-[12px]">
        <thead className="sticky top-0 bg-k-paper text-k-muted">
          <tr>
            {columns.map((column) => (
              <th key={column} className="px-3 py-1 font-normal">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={columns.map((column) => row[column]).join("\0")}>
              {columns.map((column) => {
                const value = row[column] ?? "";
                return (
                  <td key={column} className="px-3 py-0.5">
                    {isNotePath(value) ? (
                      <button
                        type="button"
                        onClick={() => onOpen(value)}
                        title={value}
                        className="text-k-accent hover:underline"
                      >
                        {noteName(value)}
                      </button>
                    ) : (
                      <span className="text-tg-4">{value}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3 py-1 text-[11px] text-k-muted">
        {rows.length === 0
          ? "nothing matches"
          : `${rows.length} ${rows.length === 1 ? "row" : "rows"}${truncated ? ", more not shown" : ""}`}
      </p>
    </div>
  );
}
