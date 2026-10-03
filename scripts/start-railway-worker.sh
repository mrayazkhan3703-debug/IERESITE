#!/bin/sh
set -eu

case "${APP_ENV:-}" in
  staging|production) ;;
  *) echo "Railway worker requires staging or production configuration" >&2; exit 1 ;;
esac
if [ "${STAGING_WEB_ONLY:-}" != "false" ] || [ "${JOB_SCHEDULER_ENABLED:-}" != "true" ]; then
  echo "Railway worker requires a dedicated scheduler" >&2
  exit 1
fi
bun run db:migrate:deploy
exec bun run worker
