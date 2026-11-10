import { render, screen } from "@testing-library/react";
import { Markdown } from "@/components/chat/markdown";

describe("Markdown", () => {
  it("draws lists, emphasis and code, not the marks that spell them", () => {
    const { container } = render(
      <Markdown text={"Done:\n\n- the **three todos**\n- a `## Focus`\n\n```\nrg todo\n```"} />,
    );

    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(screen.getByText("three todos").tagName).toBe("STRONG");
    expect(screen.getByText("## Focus").tagName).toBe("CODE");
    expect(container.querySelector("pre")).toHaveTextContent("rg todo");
    expect(container).not.toHaveTextContent("**");
  });

  it("keeps a code block under a list item or in a quote to its own lines", () => {
    for (const text of ["1. step\n\n   ```\n   a\n   b\n   ```", "> ```\n> a\n> b\n> ```"]) {
      const { container, unmount } = render(<Markdown text={text} />);
      expect(container.querySelector("pre")?.textContent).toBe("a\nb");
      unmount();
    }
  });

  it("links a web address and leaves any other scheme as text", () => {
    render(<Markdown text={"[docs](https://example.com) and [trap](javascript:alert(1))"} />);

    expect(screen.getByRole("link", { name: "docs" })).toHaveAttribute(
      "href",
      "https://example.com",
    );
    expect(screen.queryByRole("link", { name: "trap" })).toBeNull();
    expect(screen.getByText(/trap/)).toBeInTheDocument();
  });

  it("shows raw HTML as text", () => {
    const { container } = render(<Markdown text={"<img src=x onerror=alert(1)>"} />);

    expect(container.querySelector("img")).toBeNull();
    expect(container).toHaveTextContent("<img src=x onerror=alert(1)>");
  });

  it("draws a table", () => {
    const { container } = render(<Markdown text={"| a | b |\n| - | - |\n| 1 | 2 |"} />);

    expect(container.querySelectorAll("th")).toHaveLength(2);
    expect(container.querySelector("td")).toHaveTextContent("1");
  });
});
