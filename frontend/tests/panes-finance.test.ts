import { amountOf, positive } from "@/components/finance/finance-budget-tab";
import { madeOf } from "@/components/finance/finance-overview";
import { euros } from "@/lib/panes/finance/finance-words";
import { emptyLayout, fillFocused, focusedPane, isEmptyTab } from "@/lib/panes/layout/panes";
import { loadWorkspace, saveWorkspace } from "@/lib/panes/layout/workspace";

const FINE = "kasten.workspace.1";

afterEach(() => {
  localStorage.removeItem(FINE);
});

describe("the finance pane in a pane", () => {
  it("#1035 opens in the focused pane and is kept in the saved layout", () => {
    const before = emptyLayout("a.md", 12);
    const layout = fillFocused(before, { finance: true });
    const pane = focusedPane(layout);

    expect(pane.finance).toBe(true);
    expect(pane.path).toBeUndefined();
    expect(pane.id).toBe(focusedPane(before).id);
    expect(layout.tabs.every((tab) => !isEmptyTab(tab))).toBe(true);

    saveWorkspace(false, layout, true);
    expect(loadWorkspace(false)?.layout.tabs[0]?.root).toMatchObject({ finance: true });
  });
});

describe("the finance pane's amounts", () => {
  it("#1037 amounts read the German way, a sign kept, and a positive amount is above zero", () => {
    expect(amountOf("1.200")).toBe("1200");
    expect(amountOf("1.200,50")).toBe("1200.50");
    // A split part or a refund is typed with its sign, the German way too.
    expect(amountOf("-1.200")).toBe("-1200");
    expect(amountOf("\u22121.200,50")).toBe("-1200.50");
    expect(amountOf("12.5")).toBe("12.5");
    expect(positive("abc")).toBeUndefined();
    expect(positive("0")).toBeUndefined();
  });

  it("#1037 the made-of line names the reserves and the goals still to move", () => {
    const part = (total: string) => ({ total, lines: [] });
    const free = {
      ...{ total: "100.00", income: part("1000.00"), fixed: part("0.00") },
      ...{ flexible: part("0.00"), non_monthly: part("0.00"), unsorted: "0.00", saved: "0.00" },
      ...{ reserves: part("50.00"), goals: part("300.00") },
    };
    expect(madeOf(free)).toBe(
      `${euros(1000)} income, less ${euros(50)} reserved for plans, ${euros(300)} still to move to goals`,
    );
  });
});
