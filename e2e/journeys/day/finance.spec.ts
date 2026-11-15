import type { Page } from "@playwright/test";
import { openApp } from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

/** CDP's modifier bits. AltGr reads as Ctrl+Alt on Windows; Option is Alt on a Mac. */
const ALT = 1;
const CTRL = 2;

/** Types `key` the way a German layout does: AltGr+8 or Option+5 for `[`, AltGr+9 or Option+6 for `]`. */
async function typeHeld(page: Page, key: "[" | "]", modifiers: number) {
  const code =
    modifiers & CTRL ? (key === "[" ? "Digit8" : "Digit9") : key === "[" ? "Digit5" : "Digit6";
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, text: key, modifiers });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers });
  await cdp.detach();
}

for (const vim of ["on", "off"]) {
  test(`[ and ] typed through AltGr or Option step the finance pane's month, vim ${vim}`, async ({
    page,
  }) => {
    await page.addInitScript((mode) => localStorage.setItem("kasten.vim", mode), vim);
    await openApp(page);
    await page.keyboard.press("Control+Shift+P");
    await page.getByRole("option", { name: /^Open the finance pane/ }).click();
    const finance = page.getByRole("region", { name: "Finance" });
    const month = finance.getByRole("heading", { name: /^\w+ \d{4}$/ });
    await expect(month).toBeVisible();
    const shown = await month.textContent();
    await finance.focus();

    await typeHeld(page, "[", CTRL | ALT);
    await expect(month).not.toHaveText(shown ?? "");
    const before = await month.textContent();
    await typeHeld(page, "[", ALT);
    await expect(month).not.toHaveText(before ?? "");
    await typeHeld(page, "]", ALT);
    await expect(month).toHaveText(before ?? "");
    await typeHeld(page, "]", CTRL | ALT);
    await expect(month).toHaveText(shown ?? "");

    // A real chord is not the pane's: Ctrl+[ steps no month.
    await page.keyboard.press("Control+BracketLeft");
    await expect(month).toHaveText(shown ?? "");
  });
}
