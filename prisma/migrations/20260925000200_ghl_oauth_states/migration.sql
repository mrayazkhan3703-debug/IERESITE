CREATE TABLE "GhlOAuthState" (
  "stateHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "redirectUri" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GhlOAuthState_pkey" PRIMARY KEY ("stateHash"),
  CONSTRAINT "GhlOAuthState_stateHash_check" CHECK ("stateHash" ~ '^[a-f0-9]{64}$')
);

CREATE INDEX "GhlOAuthState_expiresAt_idx" ON "GhlOAuthState"("expiresAt");
CREATE INDEX "GhlOAuthState_sessionId_userId_idx" ON "GhlOAuthState"("sessionId", "userId");
