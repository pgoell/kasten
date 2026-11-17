import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { StatusBar } from "@/components/status-bar";

describe("the × beside a notice", () => {
  it("takes the notice away from its ×, which a phone's quiet bar goes with", () => {
    function Route() {
      const [notice, setNotice] = useState<string | undefined>("A book is already there");
      return <StatusBar quiet notice={notice} onDismissNotice={() => setNotice(undefined)} />;
    }
    const { container } = render(<Route />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss notice" }));
    expect(screen.queryByTestId("notice")).toBeNull();
    expect(container.querySelector("footer")).toBeNull();
  });

  it("draws no × for a bar that cannot clear its notice", () => {
    render(<StatusBar notice="A book is already there" />);

    expect(screen.queryByTestId("notice-dismiss")).toBeNull();
  });
});
