CREATE TABLE IF NOT EXISTS "WorkerHeartbeat" (
    "serviceName" TEXT NOT NULL,
    "instanceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'STARTING',
    "buildRevision" TEXT,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heartbeatAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("serviceName")
);

CREATE INDEX IF NOT EXISTS "WorkerHeartbeat_status_heartbeatAt_idx"
ON "WorkerHeartbeat"("status", "heartbeatAt");

ALTER TABLE "WorkerHeartbeat" ENABLE ROW LEVEL SECURITY;
