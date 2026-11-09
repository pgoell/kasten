"""The backend and shell images' downloads, built against a local server that fails first.

Each test builds one download stage of a Dockerfile with its release URL
pointed at a server in this process, so nothing reaches GitHub.
"""

import hashlib
import io
import subprocess
import tarfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import TYPE_CHECKING, NamedTuple

import pytest

if TYPE_CHECKING:
    from collections.abc import Iterator

ROOT = Path(__file__).parents[3]
BACKEND = ROOT / "backend" / "Dockerfile"
SHELL = ROOT / "shell" / "Dockerfile"
JJ = "/v0.37.0/jj-v0.37.0-{}-unknown-linux-musl.tar.gz"
RG = "/14.1.1/ripgrep-14.1.1-{}.tar.gz"
STARSHIP = "/v1.26.0/starship-{}-unknown-linux-musl.tar.gz"


class Stage(NamedTuple):
    name: str
    url_arg: str
    sha_arg: str
    path: str
    # Empty for a release asset that is the bare binary rather than a tarball.
    member: str
    dockerfile: Path = BACKEND

    @property
    def id(self) -> str:
        return self.name if self.dockerfile == BACKEND else f"shell-{self.name}"


STAGES = [
    Stage("jj-amd64", "JJ_RELEASES", "JJ_SHA256", JJ.format("x86_64"), "./jj"),
    Stage("jj-arm64", "JJ_RELEASES", "JJ_SHA256", JJ.format("aarch64"), "./jj"),
    Stage(
        "rg-amd64",
        "RG_RELEASES",
        "RG_SHA256",
        RG.format("x86_64-unknown-linux-musl"),
        "ripgrep-14.1.1-x86_64-unknown-linux-musl/rg",
    ),
    Stage(
        "rg-arm64",
        "RG_RELEASES",
        "RG_SHA256",
        RG.format("aarch64-unknown-linux-gnu"),
        "ripgrep-14.1.1-aarch64-unknown-linux-gnu/rg",
    ),
]

SHELL_STAGES = [
    Stage("ttyd-amd64", "TTYD_RELEASES", "TTYD_SHA256", "/1.7.7/ttyd.x86_64", "", SHELL),
    Stage("ttyd-arm64", "TTYD_RELEASES", "TTYD_SHA256", "/1.7.7/ttyd.aarch64", "", SHELL),
    Stage("herdr-amd64", "HERDR_RELEASES", "HERDR_SHA256", "/v0.8.0/herdr-linux-x86_64", "", SHELL),
    Stage(
        "herdr-arm64", "HERDR_RELEASES", "HERDR_SHA256", "/v0.8.0/herdr-linux-aarch64", "", SHELL
    ),
    *(stage._replace(dockerfile=SHELL) for stage in STAGES),
    Stage(
        "starship-amd64",
        "STARSHIP_RELEASES",
        "STARSHIP_SHA256",
        STARSHIP.format("x86_64"),
        "starship",
        SHELL,
    ),
    Stage(
        "starship-arm64",
        "STARSHIP_RELEASES",
        "STARSHIP_SHA256",
        STARSHIP.format("aarch64"),
        "starship",
        SHELL,
    ),
]


def asset(member: str) -> bytes:
    if not member:
        return b"#!/bin/sh\n"
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode="w:gz") as tar:
        data = b"#!/bin/sh\n"
        info = tarfile.TarInfo(member)
        info.size = len(data)
        info.mode = 0o755
        tar.addfile(info, io.BytesIO(data))
    return out.getvalue()


class Release:
    """Answers each GET with the next status in `statuses`, then 200 with `body`."""

    def __init__(self, path: str, body: bytes, statuses: list[int]) -> None:
        self.path = path
        self.body = body
        self.statuses = statuses
        self.hits = 0


@pytest.fixture
def release() -> Iterator[tuple[Release, str]]:
    state = Release("", b"", [])

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            state.hits += 1
            if self.path != state.path:
                status = 404
            elif state.statuses:
                status = state.statuses.pop(0)
            else:
                status = 200
            self.send_response(status)
            body = state.body if status == 200 else b"Gateway Timeout"
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format: str, *args: object) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield state, f"http://127.0.0.1:{server.server_port}"
    server.shutdown()


def build(stage: Stage, base: str, sha: str, context: Path) -> int:
    # An empty context: the download stages copy nothing in.
    return subprocess.run(  # noqa: S603
        [  # noqa: S607
            "docker",
            "build",
            "--network=host",
            "--progress=plain",
            f"--no-cache-filter={stage.name}",
            f"--target={stage.name}",
            f"--build-arg={stage.url_arg}={base}",
            f"--build-arg={stage.sha_arg}={sha}",
            "-f",
            str(stage.dockerfile),
            str(context),
        ],
        capture_output=True,
        timeout=600,
        check=False,
    ).returncode


@pytest.mark.parametrize("stage", STAGES + SHELL_STAGES, ids=lambda stage: stage.id)
def test_a_download_that_answers_504_twice_still_builds(
    release: tuple[Release, str], tmp_path: Path, stage: Stage
) -> None:
    state, base = release
    state.path, state.body, state.statuses = stage.path, asset(stage.member), [504, 504]
    sha = hashlib.sha256(state.body).hexdigest()
    assert build(stage, base, sha, tmp_path) == 0
    assert state.hits == 3


@pytest.mark.parametrize("stage", [STAGES[0], SHELL_STAGES[0]], ids=lambda stage: stage.id)
def test_a_download_that_keeps_failing_fails_the_build(
    release: tuple[Release, str], tmp_path: Path, stage: Stage
) -> None:
    state, base = release
    state.path, state.body, state.statuses = stage.path, asset(stage.member), [504] * 10
    sha = hashlib.sha256(state.body).hexdigest()
    assert build(stage, base, sha, tmp_path) != 0
    assert state.hits == 6


@pytest.mark.parametrize("stage", [STAGES[2], SHELL_STAGES[2]], ids=lambda stage: stage.id)
def test_a_download_with_the_wrong_checksum_fails_the_build(
    release: tuple[Release, str], tmp_path: Path, stage: Stage
) -> None:
    state, base = release
    state.path, state.body = stage.path, asset(stage.member)
    assert build(stage, base, "0" * 64, tmp_path) != 0
    assert state.hits == 1
