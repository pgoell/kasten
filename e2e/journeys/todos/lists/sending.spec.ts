import type { Page } from "@playwright/test";
import { listLines, openLists, phone } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";

const box = (at: Page, name: string) => at.getByRole("checkbox", { name, exact: true });

test.describe("on a phone", () => {
  test.use(phone);

  test("a row tapped where it stood while a tick was out is still that row once the tick lands (#2267)", async ({
    page,
    stack,
  }) => {
    await openLists(
      page,
      stack.vault,
      "- [x] Eier ✅ 2026-11-01\n- [x] Zitronen ✅ 2026-11-02\n- [ ] Brot\n",
    );
    let land = () => {};
    const held = new Promise<void>((resolve) => {
      land = resolve;
    });
    await page.route("**/share/lists/Einkauf/tick", async (route) => {
      await held;
      await route.continue();
    });
    const sending = page.getByText("Wird gesendet");
    await expect(sending).toBeHidden();

    await box(page, "Brot").tap();
    await expect(sending).toBeVisible();
    const eier = await box(page, "Eier").boundingBox();
    if (eier === null) throw new Error("Eier's tick is not on screen");
    land();
    await expect(sending).toBeHidden();
    await expect
      .poll(() => listLines(stack.vault))
      .toContainEqual(expect.stringMatching(/^- \[x\] Brot/));

    // The finger comes down where Eier stood while the tick was out.
    await page.touchscreen.tap(eier.x + eier.width / 2, eier.y + eier.height / 2);
    await expect(box(page, "Eier")).toHaveAttribute("aria-checked", "false");
    await expect.poll(() => listLines(stack.vault)).toContain("- [ ] Eier");
    expect(await listLines(stack.vault)).toContainEqual(expect.stringMatching(/^- \[x\] Zitronen/));
  });
});
