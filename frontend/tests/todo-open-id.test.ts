import { isOpen, newId } from "@/lib/todo/todo";
import { parsed } from "./todo-fixture";

describe("isOpen", () => {
  it("counts everything but done and rejected", () => {
    expect(isOpen(parsed("- [ ] buy milk"))).toBe(true);
    expect(isOpen(parsed("- [/] buy milk"))).toBe(true);
    expect(isOpen(parsed("- [b] buy milk"))).toBe(true);
    expect(isOpen(parsed("- [x] buy milk"))).toBe(false);
    expect(isOpen(parsed("- [-] buy milk"))).toBe(false);
  });
});

describe("newId", () => {
  it("is kt- and six hex characters", () => {
    expect(newId()).toMatch(/^kt-[0-9a-f]{6}$/);
  });

  it("takes the prefix it is given", () => {
    expect(newId("hl-")).toMatch(/^hl-[0-9a-f]{6}$/);
  });
});
