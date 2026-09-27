CREATE TABLE "GhlOAuthCredential" (
  "locationId" TEXT NOT NULL,
  "encryptedTokens" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GhlOAuthCredential_pkey" PRIMARY KEY ("locationId")
);
