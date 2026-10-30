export interface FolderNode {
  kind: "folder";
  name: string;
  path: string;
  children: TreeNode[];
}

export interface FileNode {
  kind: "file";
  /** Display name: the file name without its `.md` suffix. */
  name: string;
  path: string;
  /**
   * Set on an image, HTML page or pdf row, not a note. A field rather than a `kind`, so a folder
   * still sorts as one list, as `ls` shows it.
   */
  shows?: Shows;
}

export type Shows = "image" | "html" | "pdf";

export type TreeNode = FolderNode | FileNode;

/** Where a new note goes when the cursor is on this row: "" at the vault root. */
export function startFolder(node: TreeNode | undefined): string {
  if (!node) return "";
  if (node.kind === "folder") return `${node.path}/`;

  // A note names the folder it sits in, and a note at the root names none.
  const cut = node.path.lastIndexOf("/");
  return cut === -1 ? "" : node.path.slice(0, cut + 1);
}

export interface TreeRow {
  node: TreeNode;
  /** Index of the row holding this one, or -1 at the vault root. */
  parent: number;
}

/**
 * Every row a reader can see, in display order. `j` and `k` walk a flat list, so collapsed folders
 * keep their children out: the cursor cannot sit on a row nobody sees.
 */
export function flattenRows(nodes: TreeNode[], expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];

  function walk(level: TreeNode[], parent: number) {
    for (const node of level) {
      const index = rows.length;
      rows.push({ node, parent });
      if (node.kind === "folder" && expanded.has(node.path)) {
        walk(node.children, index);
      }
    }
  }

  walk(nodes, -1);
  return rows;
}

/**
 * Every folder on the way to `path`, which must be open for it to show. Spelled as `buildTree`
 * spells a folder: no trailing slash, unlike the note prompt's `startFolder`.
 */
export function ancestors(path: string | undefined): ReadonlySet<string> {
  const folders = new Set<string>();
  if (path === undefined) return folders;

  let prefix = "";
  for (const segment of path.split("/").slice(0, -1)) {
    prefix = prefix ? `${prefix}/${segment}` : segment;
    folders.add(prefix);
  }
  return folders;
}

/** Identifies a row across the tree and the flat list, which share no shape. */
export function rowKey(node: TreeNode) {
  return `${node.kind}:${node.path}`;
}
