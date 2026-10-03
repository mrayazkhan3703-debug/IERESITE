# Separate tooling: never imports application environment or runtime data.
ARG POSTGRES_IMAGE=pgvector/pgvector:0.8.0-pg16-bookworm@sha256:a132765ec351c65111b5b675928a3a0515a466a40f97277329db8b8209ad8bc9
FROM golang:1.25.1-bookworm@sha256:c423747fbd96fd8f0b1102d947f51f9b266060217478e5f9bf86f145969562ee AS age-build
ENV GOTOOLCHAIN=local
RUN go install -ldflags='-X main.Version=v1.3.2' filippo.io/age/cmd/age@v1.3.2 && \
    go install -ldflags='-X main.Version=v1.3.2' filippo.io/age/cmd/age-keygen@v1.3.2

FROM oven/bun:1.3.4-debian@sha256:9d9504d425a8b85c5cf162c1c354f9403e15583e0f3e1de3750ce3723d3e89ac AS bun-runtime
FROM ${POSTGRES_IMAGE}
WORKDIR /app
COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY --from=age-build /go/bin/age /go/bin/age-keygen /usr/local/bin/
COPY scripts/backup-hosted.mjs scripts/hosted-restore-checks.mjs scripts/backup-adapter.mjs scripts/check-backup-evidence.mjs scripts/r2-backup-verification.mjs scripts/report-backup-operations.mjs ./scripts/
COPY scripts/backup-source-policy.mjs ./scripts/
COPY scripts/backup-railway.mjs ./scripts/
COPY scripts/capture-railway-transition.mjs ./scripts/
COPY public ./public/
COPY docs/agent/RECOVERY_TARGETS.json docs/agent/BACKUP_OPERATIONS_POLICY.json ./docs/agent/
COPY tests/fixtures/backup-adapter-fixture.mjs ./tests/fixtures/
COPY tests/backup-adapter.test.ts tests/backup-storage-cap.test.ts tests/hosted-backup.test.ts tests/r2-backup-verification.test.ts tests/backup-operations-report.test.ts ./tests/
COPY tests/railway-backup.test.ts ./tests/
COPY bunfig.toml ./
COPY tests/disposable-environment.ts tests/require-disposable-environment.ts tests/disposable-environment.test.ts tests/transition-capture.test.ts ./tests/
USER 1000:1000
ENTRYPOINT ["bun", "--no-env-file", "scripts/backup-adapter.mjs"]
