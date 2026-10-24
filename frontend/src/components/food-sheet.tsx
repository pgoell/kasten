/**
 * The food search in the shared sheet: the right panel with a scrim on a desktop,
 * the bottom sheet on a phone. One host per editor, kept inside the editor's DOM
 * so the sheet is positioned against it. The panel element is moved in once and
 * reused, never rebuilt, so a redraw or a tap while the sheet is open keeps its
 * query, its serving and its focus.
 */

import type { Extension } from "@codemirror/state";
import { type EditorView, ViewPlugin } from "@codemirror/view";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { Sheet } from "@/components/sheet";
import type { FoodPanel } from "@/lib/food-search";
import { NARROW } from "@/lib/use-viewport";

interface Host {
  view: EditorView;
  element: HTMLElement;
  root: Root;
  /** The panel the sheet shows, once a show has given one. */
  panel: FoodPanel | null;
  /** Whether the sheet is the desktop side panel, as the last show asked. */
  side: boolean;
  /** Called when the sheet closes by its own hand: the scrim, a drag, Esc on the sheet. */
  onDismiss: () => void;
}

const hosts = new WeakMap<EditorView, Host>();

function hostOf(view: EditorView): Host {
  const known = hosts.get(view);
  if (known !== undefined) return known;
  const element = document.createElement("div");
  element.className = "cm-log-food-host";
  view.dom.append(element);
  const host: Host = {
    view,
    element,
    root: createRoot(element),
    panel: null,
    side: false,
    onDismiss: () => {},
  };
  hosts.set(view, host);
  return host;
}

function Sheeted({
  open,
  side,
  panel,
  onClose,
}: {
  open: boolean;
  side: boolean;
  panel: FoodPanel;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      label="Food search"
      side={side}
      lift={!side}
      restoreFocus={false}
    >
      {/* The panel is moved in only when it is not there already: a move of a focused
          element takes the focus with it, and a redraw must keep it. */}
      <div
        ref={(el) => {
          if (el !== null && panel.root.parentNode !== el) el.replaceChildren(panel.root);
        }}
      />
    </Sheet>
  );
}

/**
 * The focus goes back to the editor, unless it sits outside the sheet: a press
 * elsewhere has put it where the user chose, and that stays there.
 */
function giveBackFocus(host: Host): void {
  const active = document.activeElement;
  if (active === null || active === document.body || host.element.contains(active))
    host.view.focus();
}

function draw(host: Host, open: boolean): void {
  const { panel } = host;
  if (panel === null) return;
  flushSync(() =>
    host.root.render(
      <Sheeted
        open={open}
        side={host.side}
        panel={panel}
        onClose={() => {
          panel.stop();
          giveBackFocus(host);
          host.onDismiss();
        }}
      />,
    ),
  );
}

/**
 * Shows the food search panel in the sheet. Called again while it is open, it
 * keeps the panel as it is and only updates what closes it.
 */
export function showFoodSheet(view: EditorView, panel: FoodPanel, onDismiss: () => void): void {
  const host = hostOf(view);
  host.panel = panel;
  host.onDismiss = onDismiss;
  host.side = !matchMedia(NARROW).matches;
  draw(host, true);
}

/** Takes the sheet down, stops the camera and gives the focus back to the editor. */
export function hideFoodSheet(view: EditorView): void {
  const host = hosts.get(view);
  if (host === undefined || host.panel === null) return;
  host.panel.stop();
  draw(host, false);
  giveBackFocus(host);
}

/** Unmounts the sheet's React tree with its editor, so no root outlives the view. */
export const foodSheetCleanup: Extension = ViewPlugin.define((view) => ({
  destroy() {
    const host = hosts.get(view);
    if (host === undefined) return;
    hosts.delete(view);
    host.root.unmount();
  },
}));
