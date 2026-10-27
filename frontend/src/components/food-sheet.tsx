/**
 * The food search in the shared sheet: the right panel with a scrim on a desktop,
 * the bottom sheet on a phone. One host per owner, kept inside the owner's DOM
 * so the sheet is positioned against it. The panel element is moved in once and
 * reused, never rebuilt, so a redraw or a tap while the sheet is open keeps its
 * query, its serving and its focus.
 */

import type { Extension } from "@codemirror/state";
import { ViewPlugin } from "@codemirror/view";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { Sheet } from "@/components/sheet";
import type { FoodPanel } from "@/lib/log/food-search";
import { NARROW } from "@/lib/use-viewport";

/** What hosts a sheet: an editor, or a pane that is a plain element. */
export interface SheetOwner {
  dom: HTMLElement;
  focus(): void;
}

interface Host {
  owner: SheetOwner;
  element: HTMLElement;
  root: Root;
  /** The panel the sheet shows, once a show has given one. */
  panel: FoodPanel | null;
  /** Whether the sheet is the desktop side panel, as the last show asked. */
  side: boolean;
  /** Called when the sheet closes by its own hand: the scrim, a drag, Esc on the sheet. */
  onDismiss: () => void;
}

const hosts = new WeakMap<SheetOwner, Host>();

function hostOf(owner: SheetOwner): Host {
  const known = hosts.get(owner);
  if (known !== undefined) return known;
  const element = document.createElement("div");
  element.className = "cm-log-food-host";
  owner.dom.append(element);
  const host: Host = {
    owner,
    element,
    root: createRoot(element),
    panel: null,
    side: false,
    onDismiss: () => {},
  };
  hosts.set(owner, host);
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
    host.owner.focus();
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
export function showFoodSheet(owner: SheetOwner, panel: FoodPanel, onDismiss: () => void): void {
  const host = hostOf(owner);
  host.panel = panel;
  host.onDismiss = onDismiss;
  host.side = !matchMedia(NARROW).matches;
  draw(host, true);
}

/** Takes the sheet down, stops the camera and gives the focus back to the owner. */
export function hideFoodSheet(owner: SheetOwner): void {
  const host = hosts.get(owner);
  if (host === undefined || host.panel === null) return;
  host.panel.stop();
  draw(host, false);
  giveBackFocus(host);
}

/** Unmounts the sheet's React tree with its owner, so no root outlives the owner. */
export function dropFoodSheet(owner: SheetOwner): void {
  const host = hosts.get(owner);
  if (host === undefined) return;
  hosts.delete(owner);
  host.element.remove();
  // Dropping can run inside React's commit when the owner is torn down there, and a root
  // unmounted during a commit warns, so the unmount waits for the commit to finish.
  queueMicrotask(() => host.root.unmount());
}

/** Unmounts the sheet's React tree with its editor, so no root outlives the view. */
export const foodSheetCleanup: Extension = ViewPlugin.define((view) => ({
  destroy() {
    dropFoodSheet(view);
  },
}));
