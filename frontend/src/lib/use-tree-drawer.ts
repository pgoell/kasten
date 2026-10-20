import { useEffect, useMemo, useRef, useState } from "react";
import type { TreeCommands } from "@/lib/key-bindings";
import type { Layout } from "@/lib/panes";
import { type loadWorkspace, saveWorkspace } from "@/lib/workspace";

export type TreeDrawer = ReturnType<typeof useTreeDrawer>;

/**
 * The file tree's drawer or panel: whether it is open, the two counters that
 * ask it for the focus or a reveal, and the commands that drive them.
 */
export function useTreeDrawer({
  narrow,
  saved,
  savedAs,
  layout,
  focusSignal,
}: {
  narrow: boolean;
  saved: ReturnType<typeof loadWorkspace>;
  savedAs: boolean;
  layout: Layout;
  focusSignal: number;
}) {
  // Chrome the leader keys reach. It lives up here rather than in the panel
  // because the key that toggles it is pressed inside the editor.
  //
  // Shut to begin with below `md`, where it is a drawer over the page and not a
  // panel beside it. Wider, it starts the way this device last left it.
  const [treeOpen, setTreeOpen] = useState(!narrow && (saved?.treeOpen ?? true));
  // The whole workspace on every change, over whatever another kasten tab on
  // this device wrote: the last tab to move wins, and none listens for the
  // others, so two tabs never merge into a layout neither had open.
  //
  // The tree as a wide window last had it: a narrow one shuts the drawer
  // whatever was saved, and writing that down would shut the desktop's panel
  // too after a reload that only passed through a narrow window.
  const wideTree = useRef(saved?.treeOpen ?? true);
  useEffect(() => {
    if (!narrow) wideTree.current = treeOpen;
    saveWorkspace(savedAs, layout, wideTree.current);
  }, [savedAs, layout, treeOpen, narrow]);
  // The drawer covers the pane, so it shuts whenever the focus is handed to
  // one, which every way of opening something ends with. It shuts as well when
  // the window turns narrow under an open panel, a phone turned upright being
  // the case: a panel beside the note would become a drawer over it.
  //
  // Set during the render rather than in an effect. The page under the drawer
  // is inert while it is open, and the pane's own effect focuses it on the
  // commit the signal rises in, so the drawer has to be gone by that commit.
  const [shutFor, setShutFor] = useState({ narrow, focusSignal });
  if (shutFor.narrow !== narrow || shutFor.focusSignal !== focusSignal) {
    setShutFor({ narrow, focusSignal });
    if (narrow) setTreeOpen(false);
  }
  // Raised to ask the tree for the focus. A counter rather than a flag,
  // because asking twice in a row is two requests and has to read as a change.
  const [treeFocus, setTreeFocus] = useState(0);
  // Raised beside it to ask the tree to unfold down to the open note. Its own
  // counter, because the focus is asked for without the jump and this is not.
  const [treeReveal, setTreeReveal] = useState(0);
  const commands = useMemo<Pick<TreeCommands, "toggleTree" | "focusTree" | "revealTree">>(
    () => ({
      toggleTree: () => setTreeOpen((previous) => !previous),
      // Both, and in one render: a folded panel has no row to focus.
      focusTree: () => {
        setTreeOpen(true);
        setTreeFocus((previous) => previous + 1);
      },
      // All three in one render, for the reason above and one more: the panel
      // moves its cursor off the reveal and carries the focus onto the row it
      // lands on, so the focus has to be in the tree by then.
      revealTree: () => {
        setTreeOpen(true);
        setTreeReveal((previous) => previous + 1);
        setTreeFocus((previous) => previous + 1);
      },
    }),
    [],
  );

  return { treeOpen, setTreeOpen, treeFocus, treeReveal, commands };
}
