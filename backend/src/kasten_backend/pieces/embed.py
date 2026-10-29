"""bge-m3 on the CPU through its ONNX export: token offsets and dense vectors.

Loaded once per process and used from one thread at the lowest priority, with
onnxruntime's threads too: the box is shared, and first indexing must not slow
requests.
"""

import os
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import TYPE_CHECKING, Protocol

import numpy as np
import onnxruntime as ort

# A compiled module, which ty has no stubs for.
from onnxruntime.capi.onnxruntime_pybind11_state import (  # ty: ignore[unresolved-import]
    Fail,
    InvalidArgument,
    NoSuchFile,
    RuntimeException,
)
from tokenizers import Tokenizer

if TYPE_CHECKING:
    from pathlib import Path

DIMENSIONS = 1024
"""How long a bge-m3 vector is, and the width of the `pieces.embedding` column."""

BATCH = 8
"""How many pieces go through the model at once: the batch measured fastest at 512 tokens."""

THREADS = 8
"""Half the VPS's sixteen, the share the measurement on the bge-m3 page ran with."""

LONGEST = 8192
"""bge-m3's context. A piece is far shorter; this only stops a pathological one."""

PAD = 1
"""XLM-RoBERTa's padding id, which bge-m3's tokenizer keeps."""

MODEL_ERRORS = (Fail, InvalidArgument, NoSuchFile, RuntimeException)
"""What onnxruntime raises when the model will not load or will not run.

None of them derives from anything narrower than `Exception`, so they are
named here, once, for the callers to catch.
"""


class Embedder(Protocol):
    """What the indexer needs of a model: where its tokens fall, and a vector per text."""

    def offsets(self, text: str) -> list[tuple[int, int]]:
        """Character spans of each token in `text`, without the special tokens."""
        ...

    def embed(self, texts: list[str]) -> list[list[float]]:
        """One unit vector of `DIMENSIONS` floats per text, in order."""
        ...


class BgeM3:
    """bge-m3's dense output, read from the folder `KASTEN_EMBED_MODEL_DIR` names."""

    def __init__(self, folder: Path) -> None:
        """Load the model and its tokenizer: 1.8 s and 1.6 GB, once a process."""
        options = ort.SessionOptions()
        options.intra_op_num_threads = THREADS
        options.inter_op_num_threads = 1
        self._session = ort.InferenceSession(
            str(folder / "model.onnx"), options, providers=["CPUExecutionProvider"]
        )
        self._tokenizer = Tokenizer.from_file(str(folder / "tokenizer.json"))

    def offsets(self, text: str) -> list[tuple[int, int]]:
        """Character spans of each token in `text`, without the special tokens."""
        return self._tokenizer.encode(text, add_special_tokens=False).offsets

    def embed(self, texts: list[str]) -> list[list[float]]:
        """One unit vector per text, `BATCH` texts through the model at a time."""
        vectors: list[list[float]] = []
        for start in range(0, len(texts), BATCH):
            ids = [
                encoding.ids[:LONGEST]
                for encoding in self._tokenizer.encode_batch(texts[start : start + BATCH])
            ]
            width = max(len(row) for row in ids)
            batch = np.full((len(ids), width), PAD, dtype=np.int64)
            mask = np.zeros_like(batch)
            for row, piece in enumerate(ids):
                batch[row, : len(piece)] = piece
                mask[row, : len(piece)] = 1
            output = self._session.run(
                ["sentence_embedding"], {"input_ids": batch, "attention_mask": mask}
            )
            dense = np.asarray(output[0], dtype=np.float32)
            dense = dense / np.linalg.norm(dense, axis=1, keepdims=True)
            vectors.extend(dense.tolist())
        return vectors


def _lowest_priority() -> None:
    """Renice the calling thread to 19, which threads it starts inherit.

    Linux keeps a nice value per thread, so this leaves the event loop's thread
    as it was.
    """
    os.setpriority(os.PRIO_PROCESS, threading.get_native_id(), 19)


def model_thread() -> ThreadPoolExecutor:
    """The one thread the model is built and run on."""
    return ThreadPoolExecutor(
        max_workers=1, thread_name_prefix="embed", initializer=_lowest_priority
    )
