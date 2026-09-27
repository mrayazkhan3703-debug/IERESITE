# syntax=docker/dockerfile:1.7
FROM oven/bun:1.3.4-debian@sha256:9d9504d425a8b85c5cf162c1c354f9403e15583e0f3e1de3750ce3723d3e89ac AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS build
COPY . .
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run db:generate
RUN bun run build

FROM oven/bun:1.3.4-debian@sha256:9d9504d425a8b85c5cf162c1c354f9403e15583e0f3e1de3750ce3723d3e89ac AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=bun:bun /app /app
# COPY owns the contents, not the pre-existing WORKDIR. Non-root diagnostics
# and runtime-generated caches must also be able to create files in /app.
RUN chown bun:bun /app
USER bun
EXPOSE 3000 3001
CMD ["/bin/sh", "scripts/start-staging-web.sh"]
