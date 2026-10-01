FROM pgvector/pgvector:0.8.2-pg17-bookworm@sha256:feb68f4f15446397d8cac7f4fe48fe4586de83160d1fc48b46283312d1a33966
RUN apt-get update \
    && apt-get install --yes --no-install-recommends postgresql-17-postgis-3 \
    && rm -rf /var/lib/apt/lists/*
# Used only by an isolated, explicitly owned restore environment. No source credentials.
