CREATE TABLE "AiTurn" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "conversationId" TEXT NOT NULL REFERENCES "AiConversation"("id") ON DELETE CASCADE,
  "clientRequestId" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "activeKey" TEXT,
  "resultJson" TEXT,
  "errorCode" TEXT,
  "deadlineAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMPTZ(3),
  CONSTRAINT "AiTurn_status_check" CHECK ("status" IN ('PENDING', 'SUCCEEDED', 'FAILED')),
  CONSTRAINT "AiTurn_active_check" CHECK (("status" = 'PENDING' AND "activeKey" = "conversationId") OR ("status" <> 'PENDING' AND "activeKey" IS NULL))
);
CREATE UNIQUE INDEX "AiTurn_activeKey_key" ON "AiTurn"("activeKey");
CREATE UNIQUE INDEX "AiTurn_conversationId_clientRequestId_key" ON "AiTurn"("conversationId", "clientRequestId");
CREATE INDEX "AiTurn_conversationId_createdAt_idx" ON "AiTurn"("conversationId", "createdAt");
CREATE INDEX "AiTurn_status_deadlineAt_idx" ON "AiTurn"("status", "deadlineAt");
