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
   * Set on a row that is an image, an HTML page or a pdf rather than a note.
   *
   * A field and not another `kind`, so a folder's contents still sort as one
   * alphabetical list: images, pages, pdfs and notes sit side by side the way
   * `ls` shows them, rather than in groups nobody arranged.
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
 * Every row a reader can see, in display order.
 *
 * The nesting is what the tree renders, but `j` and `k` move down a list, so
 * the keyboard needs the same rows flattened. Collapsed folders keep their
 * children out of it, because a cursor cannot sit on a row nobody can see.
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
 * Every folder on the way to `path`, which are the ones that have to be open
 * for it to be on screen.
 *
 * `reading/2026/borges.md` names `reading` and `reading/2026`, spelled the way
 * `buildTree` spells a folder's path, which is without a trailing slash. The
 * note prompt's `startFolder` keeps one; these two are not the same string.
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
