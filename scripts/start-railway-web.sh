#!/bin/sh
set -eu
if [ "${APP_ENV:-}" != "staging" ] && [ "${APP_ENV:-}" != "production" ]; then
  echo "Railway web requires staging or production configuration" >&2
  exit 1
fi
if [ "${JOB_SCHEDULER_ENABLED:-}" != "false" ]; then
  echo "Run the scheduler in the dedicated worker service" >&2
  exit 1
fi
bun run db:migrate:deploy
# Company records and authorization already exist. Demo seed is an explicit
# development command, never part of a deployment or restart.
exec bun .next/standalone/server.js
