import { ApiError } from "@/lib/api-client";
import { t, type Locale } from "@/lib/i18n";

const codeKeys: Record<string, string> = {
  INVALID_CREDENTIALS: "auth.invalidCredentials",
  LOCKED: "auth.locked",
  EMAIL_VERIFICATION_REQUIRED: "auth.emailVerificationRequired",
  RATE_LIMITED: "auth.rateLimited",
  VALIDATION: "auth.validation",
  EMAIL_TAKEN: "auth.emailTaken",
  INVALID_MFA_CODE: "auth.invalidMfaCode",
  INVALID_CHALLENGE: "auth.invalidChallenge",
};

export function authFormError(error: unknown, locale: Locale): string {
  const key = error instanceof ApiError && error.code && Object.hasOwn(codeKeys, error.code) ? codeKeys[error.code] : undefined;
  // Never turn arbitrary server/transport exception text into UI copy.
  return t(key ?? "auth.failed", locale);
}
