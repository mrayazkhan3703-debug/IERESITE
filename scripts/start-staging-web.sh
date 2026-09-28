#!/bin/sh
set -eu

if [ "${APP_ENV:-}" != "staging" ] || [ "${STAGING_WEB_ONLY:-}" != "false" ] || [ "${JOB_SCHEDULER_ENABLED:-}" != "false" ]; then
  echo "Refusing to start outside the dedicated-worker staging web profile" >&2
  exit 1
fi

# Render's free web plan has no pre-deploy hook. Prisma's migration engine
# applies pending migrations before the HTTP listener starts, and fails closed.
bun run db:migrate:deploy
exec bun .next/standalone/server.js
