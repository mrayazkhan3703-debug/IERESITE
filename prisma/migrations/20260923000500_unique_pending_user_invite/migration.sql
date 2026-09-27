CREATE UNIQUE INDEX "UserInvitation_one_pending_per_email_key" ON "UserInvitation"("email")
  WHERE "acceptedAt" IS NULL AND "revokedAt" IS NULL;
