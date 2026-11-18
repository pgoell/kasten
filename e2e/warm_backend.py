"""Forks a fresh backend per e2e test from a process that loaded its libraries once (#1980).

`python warm_backend.py SOCKET` prints `ready`, then serves one client per connection: the
client sends a JSON line `{"env": {...}, "cwd": "..."}` and reads back the child's `pid N`
line, its output, and a last line of NUL, `exit ` and the code or signal name. It ends when
its stdin closes, so a worker that dies leaves no parent behind.
"""

import contextlib
import json
import os
import selectors
import signal
import socket
import sys
import threading
import traceback
import warnings

import uvicorn

# The child drops kasten_backend and imports it again; the libraries it pulls stay loaded.
import kasten_backend.main  # noqa: F401

OWN = "kasten_backend"


# numpy's OpenBLAS threads are the only others; OpenBLAS stops its pool around a fork.
warnings.filterwarnings("ignore", "This process .* is multi-threaded", DeprecationWarning)


def main(path: str) -> None:
    """Serve forks on the unix socket at `path` until stdin closes."""
    if threading.active_count() != 1:
        raise SystemExit("a fork copies a held lock of another thread")
    listener = socket.socket(socket.AF_UNIX)
    listener.bind(path)
    listener.listen()
    # SIGCHLD only wakes the loop through this pipe; the child puts the default back.
    woken, wake = os.pipe()
    os.set_blocking(wake, False)
    signal.set_wakeup_fd(wake)
    signal.signal(signal.SIGCHLD, lambda *_: None)
    picks = selectors.DefaultSelector()
    picks.register(listener, selectors.EVENT_READ)
    picks.register(0, selectors.EVENT_READ)
    picks.register(woken, selectors.EVENT_READ)
    children: dict[int, socket.socket] = {}
    print("ready", flush=True)
    while True:
        for key, _ in picks.select():
            if key.fileobj == 0:
                if not os.read(0, 4096):
                    return
            elif key.fileobj is listener:
                _start(listener.accept()[0], children, [listener.fileno(), woken, wake])
            else:
                os.read(woken, 4096)
                _reap(children)


def _start(conn: socket.socket, children: dict[int, socket.socket], fds: list[int]) -> None:
    request = b""
    while not request.endswith(b"\n"):
        chunk = conn.recv(65536)
        if not chunk:
            conn.close()
            return
        request += chunk
    pid = os.fork()
    if pid == 0:
        _serve(conn, json.loads(request), [*fds, *(other.fileno() for other in children.values())])
    children[pid] = conn


def _reap(children: dict[int, socket.socket]) -> None:
    for pid in list(children):
        done, status = os.waitpid(pid, os.WNOHANG)
        if not done:
            continue
        conn = children.pop(pid)
        code = os.waitstatus_to_exitcode(status)
        ended = str(code) if code >= 0 else signal.Signals(-code).name
        # A client may stop reading, after a test that failed to start.
        with contextlib.suppress(BrokenPipeError):
            conn.sendall(b"\0exit " + ended.encode() + b"\n")
        conn.close()


def _serve(conn: socket.socket, request: dict, fds: list[int]) -> None:
    code = 1
    try:
        os.setsid()
        signal.signal(signal.SIGCHLD, signal.SIG_DFL)
        signal.set_wakeup_fd(-1)
        # A fork keeps every fd: a held copy of another test's socket would keep it open.
        for fd in fds:
            os.close(fd)
        os.dup2(os.open(os.devnull, os.O_RDONLY), 0)
        os.dup2(conn.fileno(), 1)
        os.dup2(conn.fileno(), 2)
        conn.close()
        sys.stdout = open(1, "w", buffering=1)  # noqa: SIM115
        sys.stderr = open(2, "w", buffering=1)  # noqa: SIM115
        print(f"pid {os.getpid()}")
        os.environ.update(request["env"])
        os.chdir(request["cwd"])
        for name in [name for name in sys.modules if name == OWN or name.startswith(OWN + ".")]:
            del sys.modules[name]
        uvicorn.run("kasten_backend.main:app", host="127.0.0.1", port=0)
        code = 0
    except SystemExit as stop:
        code = stop.code if isinstance(stop.code, int) else 1
    except Exception:  # the child must never fall back into the parent's loop
        traceback.print_exc()
    finally:
        sys.stdout.flush()
        sys.stderr.flush()
        os._exit(code)


if __name__ == "__main__":
    main(sys.argv[1])
