/**
 * Spending the window's user activation, the one sign of a reader's press that
 * a page in kasten's frame cannot forge (#877).
 *
 * A key or click in the frame activates the frame and every window above it,
 * kasten's included, for a few seconds. Nothing in the DOM spends it but an API
 * that shows something, such as a popup or fullscreen. `showPicker` on a text
 * field with no list is the one that shows nothing: the HTML spec has it consume
 * the activation first, and a plain text field has no picker to open. Consuming
 * clears the activation of the whole frame tree, and it runs in kasten's
 * document, out of the page's reach.
 */

let spender: HTMLInputElement | null = null;

/** The field the picker is asked of: rendered, as `showPicker` needs, but unseen and unreachable. */
function field(): HTMLInputElement {
  if (spender?.isConnected) return spender;
  spender = document.createElement("input");
  spender.type = "text";
  spender.tabIndex = -1;
  spender.autocomplete = "off";
  spender.setAttribute("aria-hidden", "true");
  spender.style.cssText =
    "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
  document.body.append(spender);
  return spender;
}

/**
 * Spend the user activation, if there is one. Answers whether none is left, so
 * a browser that has no `navigator.userActivation` or that did not consume it
 * answers false, and the caller falls back to a rule of its own.
 */
export function spendActivation(): boolean {
  const activation = navigator.userActivation;
  if (activation === undefined) return false;
  if (!activation.isActive) return true;
  const input = field();
  if (typeof input.showPicker === "function") {
    try {
      input.showPicker();
    } catch (error) {
      // A browser that will not show this field's picker throws a named
      // DOMException, and the activation it left is answered below.
      if (!(error instanceof DOMException)) throw error;
    }
  }
  return !activation.isActive;
}
