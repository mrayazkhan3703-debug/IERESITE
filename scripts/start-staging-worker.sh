#!/bin/sh
set -eu

if [ "${APP_ENV:-}" != "staging" ] || [ "${STAGING_WEB_ONLY:-}" != "false" ] || [ "${JOB_SCHEDULER_ENABLED:-}" != "true" ]; then
  echo "Refusing to start outside the dedicated-worker staging profile" >&2
  exit 1
fi

# Either service may be deployed first. Prisma serializes concurrent deploys,
# so both fail closed until the shared schema is current.
bun run db:migrate:deploy
exec bun run worker
