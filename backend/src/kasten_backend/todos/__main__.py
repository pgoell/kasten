"""Move the vault's todo lines into the store: `python -m kasten_backend.todos [--write]`.

A dry run unless `--write`, against `KASTEN_VAULT_PATH` and `KASTEN_DATABASE_URL`.
"""

import asyncio
import sys

from kasten_backend import db
from kasten_backend.config import get_settings
from kasten_backend.todos import importer


async def main(write: bool) -> None:
    """Run the import, or the dry run, and say which it was."""
    async with db.session() as session:
        print(await importer.run(get_settings(), session, dry=not write))
    print("written" if write else "dry run: nothing written; pass --write to import")


asyncio.run(main("--write" in sys.argv[1:]))
