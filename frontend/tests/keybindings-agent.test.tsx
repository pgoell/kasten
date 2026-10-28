import { fireEvent, render } from "@testing-library/react";
import { Editor } from "@/components/editor";
import { open, pinClock, stubCommands, TODAY } from "./keybindings-fixture";

// The code stamps the date at the keypress, so the clock is held on `TODAY`.
pinClock();

describe("#523 the agent key", () => {
  /**
   * An editor over `initialDoc` with `<leader>@` pressed on its last line, every
   * document it reported and every notice it raised. `G` puts the cursor there,
   * so the line under test sits last.
   */
  function pressAgent(initialDoc: string, before: string[] = ["G"], after: string[] = []) {
    const onChange = vi.fn();
    const onNotice = vi.fn();
    const { container } = render(
      <Editor
        initialDoc={initialDoc}
        commands={stubCommands()}
        onChange={onChange}
        onNotice={onNotice}
      />,
    );
    const editor = container.querySelector(".cm-content") as HTMLElement;
    for (const key of [...before, " ", "@", ...after]) fireEvent.keyDown(editor, { key });

    return {
      docs: onChange.mock.calls.map((call) => call[0] as string),
      doc: (onChange.mock.lastCall?.[0] as string | undefined) ?? initialDoc,
      onNotice,
    };
  }

  it("#523 A4 A7 <leader>@ with vim on adds #agent at the end of the words, before the fields", () => {
    const { doc } = pressAgent("\t- [ ] call  [[a 📅 b]] 📅 2026-10-20 ^blk1");

    expect(doc).toBe("\t- [ ] call  [[a 📅 b]] #agent 📅 2026-10-20 ^blk1");
  });

  it("#523 A4 A7 <leader>@ on a [ ] todo carrying #agent takes out the tag and one space", () => {
    const { doc } = pressAgent("\t- [ ]  call #agent 📅 2026-10-20 ^blk1");

    expect(doc).toBe("\t- [ ]  call 📅 2026-10-20 ^blk1");
  });

  it("#523 A4 <leader>@ on a doing todo carrying #agent leaves it and says it is with the agent", () => {
    const { doc, onNotice } = pressAgent("- [/] call #agent");

    expect.soft(doc).toBe("- [/] call #agent");
    expect(onNotice).toHaveBeenCalledWith("Nothing moved: that todo is already with the agent");
  });

  it("#523 A4 <leader>@ adds #agent to a done todo lacking it", () => {
    const { doc } = pressAgent("- [x] call ✅ 2026-10-16");

    expect(doc).toBe("- [x] call #agent ✅ 2026-10-16");
  });

  it("#523 A5 <leader>@ refuses a #client todo, even one carrying #agent", () => {
    const { docs, onNotice } = pressAgent("- [ ] call #client #agent");

    expect.soft(docs).toEqual([]);
    expect(onNotice).toHaveBeenCalledWith("Nothing moved: the agent skips client work");
  });

  it("#523 A5 <leader>@ refuses a todo two steps under a #client todo", () => {
    const { docs, onNotice } = pressAgent("- [ ] big #client\n  - [ ] part\n    - [ ] call");

    expect.soft(docs).toEqual([]);
    expect(onNotice).toHaveBeenCalledWith("Nothing moved: the agent skips client work");
  });

  it("#523 A5 <leader>@ adds #agent under #client prose, only a todo passing client down", () => {
    const { doc } = pressAgent("big #client\n  - [ ] call");

    expect(doc).toBe("big #client\n  - [ ] call #agent");
  });

  it("#523 I6 <leader>@ adds #agent beside a #client sibling", () => {
    const { doc } = pressAgent("- [ ] big #client\n- [ ] call");

    expect(doc).toBe("- [ ] big #client\n- [ ] call #agent");
  });

  it("#523 I6 <leader>@ adds #agent under a parent whose other part is #client", () => {
    const { doc } = pressAgent("- [ ] big\n  - [ ] other #client\n  - [ ] call");

    expect(doc).toBe("- [ ] big\n  - [ ] other #client\n  - [ ] call #agent");
  });

  it("#523 A6 <leader>@ on a plain line makes it an open todo, then tags it", () => {
    const { doc } = pressAgent("call ada");

    expect(doc).toBe(`- [ ] call ada #agent ➕ ${TODAY}`);
  });

  it("#523 I4 <leader>@ reads #agents and #agent/x as other tags, adding #agent beside them", () => {
    const { doc } = pressAgent("- [ ] call #agents #agent/x 📅 2026-10-20");

    expect(doc).toBe("- [ ] call #agents #agent/x #agent 📅 2026-10-20");
  });

  it("#523 I1 <leader>@ leaves the cursor on its character", () => {
    // `$` onto the last digit, and `x` after the press cuts whatever it is on.
    const { doc } = pressAgent("- [ ] call 📅 2026-10-20", ["$"], ["x"]);

    expect(doc).toBe("- [ ] call #agent 📅 2026-10-2");
  });

  it("#523 I1 one u takes back the whole of <leader>@ on a plain line", () => {
    const { docs } = pressAgent("call ada", ["G"], ["u"]);

    expect(docs).toEqual([`- [ ] call ada #agent ➕ ${TODAY}`, "call ada"]);
  });

  it("#523 A7 <leader>@ reads 2^10 as words, not a block id", () => {
    const { doc } = pressAgent("- [ ] compute 2^10");

    expect(doc).toBe("- [ ] compute 2^10 #agent");
  });

  it("#523 A7 <leader>@ twice on 2^10 gives the line back byte for byte", () => {
    const { docs } = pressAgent("- [ ] compute 2^10", ["G"], [" ", "@"]);

    expect(docs).toEqual(["- [ ] compute 2^10 #agent", "- [ ] compute 2^10"]);
  });

  it("#523 A7 <leader>@ twice on a field hard against the words gives the line back byte for byte", () => {
    const { docs } = pressAgent("- [ ] foo📅 2026-10-20", ["G"], [" ", "@"]);

    expect(docs).toEqual(["- [ ] foo📅 2026-10-20 #agent", "- [ ] foo📅 2026-10-20"]);
  });

  it("#523 A7 <leader>@ twice on words hard against two fields puts #agent past both and gives the line back", () => {
    const line = "- [ ] foo📅 2026-10-20 ⏳ 2026-10-21 ^blk1";
    const { docs } = pressAgent(line, ["G"], [" ", "@"]);

    expect(docs).toEqual(["- [ ] foo📅 2026-10-20 ⏳ 2026-10-21 #agent ^blk1", line]);
  });

  it("#523 B <leader>@ adds #agent past a code span holding #agent, the span untouched", () => {
    const { doc } = pressAgent("- [ ] run `grep #agent log`");

    expect(doc).toBe("- [ ] run `grep #agent log` #agent");
  });

  it("#523 B <leader>@ adds #agent past a link holding #agent, the link untouched", () => {
    const { doc } = pressAgent("- [ ] read [[notes#agent]]");

    expect(doc).toBe("- [ ] read [[notes#agent]] #agent");
  });

  it("#523 B <leader>@ adds #agent past a URL ending #agent, the URL untouched", () => {
    const { doc } = pressAgent("- [ ] see https://a.io/p#agent");

    expect(doc).toBe("- [ ] see https://a.io/p#agent #agent");
  });

  it("#523 B <leader>@ on a doing todo with #agent only in a span adds the tag", () => {
    const { doc } = pressAgent("- [/] run `grep #agent log`");

    expect(doc).toBe("- [/] run `grep #agent log` #agent");
  });

  it("#523 A10 vim's own @ still replays a macro", () => {
    const { editor, doc } = open("abc");

    for (const key of ["q", "a", "x", "q", "@", "a"]) fireEvent.keyDown(editor, { key });

    expect(doc()).toBe("c");
  });
});
