ALTER TABLE "User"
  ADD COLUMN "mfaSecretCiphertext" TEXT,
  ADD COLUMN "mfaEnabledAt" TIMESTAMPTZ(3),
  ADD COLUMN "mfaRecoveryCodesJson" TEXT;

ALTER TABLE "Session"
  ADD COLUMN "mfaVerifiedAt" TIMESTAMPTZ(3);
