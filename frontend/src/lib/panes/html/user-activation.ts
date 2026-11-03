/**
 * Spends the user activation, the one press signal a framed page cannot forge (#877). `showPicker`
 * on a plain text field consumes it without showing anything.
 */

let spender: HTMLInputElement | null = null;

/** Rendered, as `showPicker` needs, but hidden and unreachable. */
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

/** Spends the activation. True when none is left; false means the caller needs its own rule. */
export function spendActivation(): boolean {
  const activation = navigator.userActivation;
  if (activation === undefined) return false;
  if (!activation.isActive) return true;
  const input = field();
  if (typeof input.showPicker === "function") {
    try {
      input.showPicker();
    } catch (error) {
      // Some browsers throw a DOMException here; the activation check below still answers.
      if (!(error instanceof DOMException)) throw error;
    }
  }
  return !activation.isActive;
}
