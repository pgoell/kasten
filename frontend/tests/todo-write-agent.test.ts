import { agentPress } from "@/lib/todo-agent";
import { TODAY, todo } from "./todo-write-fixture";

describe("#617 a hash in a span or an address is no tag", () => {
  it("#617 I5 @ reads #agent as parseTodo does, taking back one hard against a comma", () => {
    const line = "- [ ] fix the build,#agent";

    expect.soft(todo(line).tags).toEqual(["#agent"]);
    expect(agentPress([line], 1, TODAY, "kt-000001")).toEqual({ line: "- [ ] fix the build," });
  });

  it("#617 I5 @ reads #agent hard against a date as parseTodo does, taking it back", () => {
    const line = "- [ ] fix 📅 2026-10-20#agent";

    expect.soft(todo(line).tags).toEqual(["#agent"]);
    expect(agentPress([line], 1, TODAY, "kt-000001")).toEqual({ line: "- [ ] fix 📅 2026-10-20" });
  });

  it("#617 B @ reads no tag inside a field's value and adds one, the value untouched", () => {
    const press = (line: string) => agentPress([line], 1, TODAY, "kt-000001");

    expect.soft(press("- [ ] fix 🆔 kt-aaaaaa,#agent")).toEqual({
      line: "- [ ] fix #agent 🆔 kt-aaaaaa,#agent",
    });
    expect
      .soft(press("- [ ] fix 👤 bob,#agent"))
      .toEqual({ line: "- [ ] fix #agent 👤 bob,#agent" });
    expect(press("- [ ] fix ⏲ 1h,#agent")).toEqual({ line: "- [ ] fix #agent ⏲ 1h,#agent" });
  });

  it("#617 B @ leaves #agent in where taking it out would make a tag of what follows", () => {
    expect(agentPress(["- [ ] fix,#agent#kasten"], 1, TODAY, "kt-000001")).toEqual({
      why: "taking #agent out would make a tag of what follows it",
    });
  });
});

describe("#627 a tag ends where the editor's tag ends", () => {
  it("#627 I2 @ takes off #agent in brackets or before a stop rather than adding a second", () => {
    const press = (line: string) => agentPress([line], 1, TODAY, "kt-000001");

    // Only the tag goes, so the brackets and the stop stay with the words.
    expect.soft(press("- [ ] fix (#agent)")).toEqual({ line: "- [ ] fix ()" });
    expect(press("- [ ] fix #agent.")).toEqual({ line: "- [ ] fix." });
  });
});
