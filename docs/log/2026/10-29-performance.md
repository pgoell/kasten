# 2026-10-29: the review's and the board's cost

* **Test**: [Phone performance](/reference/phone-performance.md#the-flashcard-review-and-the-todo-board) measures the flashcard review and the todo board on a copy of the live vault (#1321): the reads at p50 and p95 over 20 calls, and the frames at phone width on fixtures of the vault's size, with the load average beside each number. `GET /api/cards` is the slow read, 203 ms for 9,357 lines of which `rg` takes 10 ms (#1353).
