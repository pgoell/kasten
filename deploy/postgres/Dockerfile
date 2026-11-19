# deploy/postgres/Dockerfile
#
# Postgres with pgvector and pg_textsearch, for dev (compose.yaml) and CI. The
# shared prod container builds the same file from pgoell/server-infra, so keep
# the two in step.
#
# Built from source on the alpine image prod already ran, and not swapped for a
# Debian one: musl and glibc sort text differently, and a data directory moved
# between them needs every text index rebuilt.

FROM postgres:17.11-alpine3.24@sha256:e5d2edd28b1f8d40a0a6c0c9cdc545b19b56a0d5d88f94bc11a97d970d4700d0

ARG PGVECTOR_VERSION=v0.8.7
ARG PG_TEXTSEARCH_VERSION=v1.5.1

# `with_llvm=no`: the base was built with LLVM for JIT, and PGXS would otherwise
# want clang to emit bitcode that nothing here needs.
#
# `trusted = true` lets the database owner run CREATE EXTENSION, which is how
# kasten's migration creates both: kasten_prod owns its database but is no
# superuser.
#
# The preload goes into the sample config, which initdb copies into a new data
# directory. A data directory that already exists keeps its own config, so
# prod and dev (compose.yaml) pass the same setting on their command line too.
RUN apk add --no-cache --virtual .build git build-base \
 && git clone --depth 1 --branch "$PGVECTOR_VERSION" https://github.com/pgvector/pgvector.git /tmp/pgvector \
 && make -C /tmp/pgvector with_llvm=no OPTFLAGS="" install \
 && git clone --depth 1 --branch "$PG_TEXTSEARCH_VERSION" https://github.com/timescale/pg_textsearch.git /tmp/pg_textsearch \
 && make -C /tmp/pg_textsearch with_llvm=no install \
 && rm -rf /tmp/pgvector /tmp/pg_textsearch \
 && apk del .build \
 && for ext in vector pg_textsearch; do echo "trusted = true" >> "/usr/local/share/postgresql/extension/$ext.control"; done \
 && echo "shared_preload_libraries = 'pg_textsearch'" >> /usr/local/share/postgresql/postgresql.conf.sample
