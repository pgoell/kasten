import { QueryClient } from "@tanstack/react-query";
import { deleteTodo, StaleTodoError } from "@/lib/todo/view/todo-store";

const { DELETE } = vi.hoisted(() => ({ DELETE: vi.fn() }));
vi.mock("@/lib/core/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/core/api-client")>()),
  client: { DELETE },
}));

const queries = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const answered = (status: number) => ({
  response: new Response(null, { status }),
  error: status === 204 ? undefined : { detail: "kt-aaaaaa moved on." },
});

describe("deleting a todo from the store", () => {
  it("sends the version it was read at", async () => {
    DELETE.mockResolvedValue(answered(204));
    await deleteTodo(queries(), "kt-aaaaaa", 3);
    expect(DELETE).toHaveBeenCalledWith("/api/todos/{todo_id}", {
      params: { path: { todo_id: "kt-aaaaaa" }, query: { version: 3 } },
    });
  });

  it("answers a 409 with a StaleTodoError, and any other refusal with a plain error", async () => {
    DELETE.mockResolvedValue(answered(409));
    await expect(deleteTodo(queries(), "kt-aaaaaa", 3)).rejects.toBeInstanceOf(StaleTodoError);
    DELETE.mockResolvedValue(answered(500));
    const failed = deleteTodo(queries(), "kt-aaaaaa", 3);
    await expect(failed).rejects.toThrow("kt-aaaaaa moved on.");
    await expect(failed).rejects.not.toBeInstanceOf(StaleTodoError);
  });
});
