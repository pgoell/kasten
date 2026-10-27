"""Print the backend's OpenAPI schema to stdout.

Used by scripts/gen_frontend_types.sh to feed openapi-typescript without
having to boot a server first.
"""

import json

from kasten_backend.main import app

# The dumped file is committed. A release number in it would move
# frontend/openapi.json on every release and force a frontend image rebuild for
# nothing. The served schema still carries the real version.
schema = app.openapi()
info = {**schema["info"], "version": "0.0.0"}
print(json.dumps({**schema, "info": info}, indent=2))
