"""Print a fresh VAPID pair: `python -m kasten_backend.push`."""

from kasten_backend.push.webpush import new_keys

private, public = new_keys()
print(f"KASTEN_PUSH_PRIVATE_KEY={private}")
print(f"# public key, served to the browser: {public}")
