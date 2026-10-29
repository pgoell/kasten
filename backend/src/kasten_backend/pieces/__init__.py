"""The pieces index: notes cut into pieces, each with a bge-m3 vector and BM25 text.

`indexer.start` is the way in; the backend calls it once at startup. The rest
of the package serves it: `split` cuts a note, `embed` runs the model, `models`
holds the two tables.
"""
