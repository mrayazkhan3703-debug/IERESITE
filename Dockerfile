# syntax=docker/dockerfile:1.7
FROM pgvector/pgvector:0.8.0-pg16-bookworm@sha256:a132765ec351c65111b5b675928a3a0515a466a40f97277329db8b8209ad8bc9 AS postgres-tools
FROM golang:1.25.1-bookworm@sha256:c423747fbd96fd8f0b1102d947f51f9b266060217478e5f9bf86f145969562ee AS age-build
ENV GOTOOLCHAIN=local
RUN go install -ldflags='-X main.Version=v1.3.2' filippo.io/age/cmd/age@v1.3.2

FROM oven/bun:1.3.4-debian@sha256:9d9504d425a8b85c5cf162c1c354f9403e15583e0f3e1de3750ce3723d3e89ac AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS build
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
COPY . .
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run db:generate
RUN bun run build

FROM oven/bun:1.3.4-debian@sha256:9d9504d425a8b85c5cf162c1c354f9403e15583e0f3e1de3750ce3723d3e89ac AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libpq5 liblz4-1 libzstd1 && rm -rf /var/lib/apt/lists/*
COPY --from=postgres-tools /usr/lib/postgresql/16/bin/pg_dump /usr/lib/postgresql/16/bin/pg_restore /usr/local/bin/
COPY --from=postgres-tools /usr/lib/x86_64-linux-gnu/libpq.so.5* /opt/iere-postgres/lib/
COPY --from=postgres-tools /usr/lib/x86_64-linux-gnu/libldap-2.5.so.0* /usr/lib/x86_64-linux-gnu/liblber-2.5.so.0* /opt/iere-postgres/lib/
COPY --from=age-build /go/bin/age /usr/local/bin/age
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=bun:bun /app /app
# COPY owns the contents, not the pre-existing WORKDIR. Non-root diagnostics
# and runtime-generated caches must also be able to create files in /app.
RUN chown bun:bun /app
USER bun
EXPOSE 3000 3001
CMD ["/bin/sh", "scripts/start-staging-web.sh"]
