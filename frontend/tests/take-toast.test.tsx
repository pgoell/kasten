import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TakeToast } from "@/components/take-toast";

const { searchNotes } = vi.hoisted(() => ({ searchNotes: vi.fn() }));
vi.mock("@/lib/api", () => ({ searchNotes }));

/** The toast alone, with the query client its note list makes its searches through. */
function renderToast(top?: boolean) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TakeToast
        title="Taken into today's dump"
        passage="A passage of the report."
        source="Results, report.html"
        archive={false}
        onPut={() => {}}
        onDone={() => {}}
        top={top}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  searchNotes.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("the take toast alone", () => {
  it("the list says nothing was written lately when there is nothing", async () => {
    renderToast();

    fireEvent.click(screen.getByRole("button", { name: "Put it in a note" }));

    expect(await screen.findByText("Nothing written lately.")).not.toBeNull();
  });

  it("the toast sits at the foot unless it is told to go to the top", () => {
    const foot = renderToast();
    const footClass = screen.getByRole("status").className;
    foot.unmount();

    renderToast(true);
    const topClass = screen.getByRole("status").className;

    expect({
      foot: footClass.includes("bottom-3"),
      top: topClass.includes("top-3") && !topClass.includes("bottom-3"),
    }).toEqual({ foot: true, top: true });
  });
});
