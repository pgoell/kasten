import { paneKind, panePath } from "@/components/kind-icons";

describe("kind icons", () => {
  it("A3 paneKind maps a pdf, a book, a review, an exam, a graph, a video and a note", () => {
    expect(paneKind({ id: "p", pdf: { path: "x.pdf", opened: 1 } })).toBe("pdf");
    expect(paneKind({ id: "p", book: "b.md" })).toBe("book");
    expect(paneKind({ id: "p", review: true })).toBe("review");
    expect(paneKind({ id: "p", exam: "e.md" })).toBe("review");
    expect(paneKind({ id: "p", graph: {} })).toBe("graph");
    expect(paneKind({ id: "p", video: "v.md" })).toBe("video");
    expect(paneKind({ id: "p", path: "a.md" })).toBe("page");
  });

  it("A3 panePath names what the pane shows", () => {
    expect(panePath({ id: "p", path: "a.md" })).toBe("a.md");
    expect(panePath({ id: "p", pdf: { path: "x/plan.pdf", opened: 1 } })).toBe("x/plan.pdf");
    expect(panePath({ id: "p", book: "b.md" })).toBe("b.md");
    expect(panePath({ id: "p", graph: { around: "g.md" } })).toBe("g.md");
    expect(panePath({ id: "p", graph: {} })).toBeUndefined();
    expect(panePath({ id: "p" })).toBeUndefined();
  });
});
