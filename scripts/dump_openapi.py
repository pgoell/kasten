"""Print the backend's OpenAPI schema to stdout.

Used by scripts/gen_frontend_types.sh to feed openapi-typescript without
having to boot a server first.
"""

import json

from kasten_backend.main import app

print(json.dumps(app.openapi(), indent=2))
