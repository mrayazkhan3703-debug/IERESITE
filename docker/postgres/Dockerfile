FROM pgvector/pgvector:0.8.0-pg16-bookworm@sha256:a132765ec351c65111b5b675928a3a0515a466a40f97277329db8b8209ad8bc9

RUN apt-get update \
    && apt-get install --yes --no-install-recommends postgresql-16-postgis-3 \
    && rm -rf /var/lib/apt/lists/*

COPY docker/postgres/init/001-extensions.sql /docker-entrypoint-initdb.d/001-extensions.sql
