import { render, waitFor } from "@testing-library/react";
import { Editor } from "@/components/editor";
import { Leaving } from "@/lib/leaving";

// Red on main is not possible: `Leaving` is new with #983, so main cannot import it.
// What this pins is the rule the editor follows once it has the context.
it("#983 a leaving editor keeps the text it shows and takes the vault's when it comes back", async () => {
  const text = () => document.querySelector(".cm-content")?.textContent;
  const { rerender } = render(
    <Leaving.Provider value={false}>
      <Editor initialDoc="held text" reloadDoc="held text" />
    </Leaving.Provider>,
  );

  rerender(
    <Leaving.Provider value={true}>
      <Editor initialDoc="held text" reloadDoc="vault text" />
    </Leaving.Provider>,
  );
  expect(text()).toBe("held text");

  rerender(
    <Leaving.Provider value={false}>
      <Editor initialDoc="held text" reloadDoc="vault text" />
    </Leaving.Provider>,
  );
  await waitFor(() => expect(text()).toBe("vault text"));
});
