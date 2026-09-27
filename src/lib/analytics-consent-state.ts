export type VerifiedConsentState = {
  essential: true;
  analytics: boolean;
  marketing: boolean;
  personalization: boolean;
};

export type ConsentServerSnapshot = {
  decided: boolean;
  analytics: boolean;
  marketing: boolean;
  personalization: boolean;
};

const DENIED: VerifiedConsentState = {
  essential: true,
  analytics: false,
  marketing: false,
  personalization: false,
};

let current: VerifiedConsentState | null = null;

/** No analytics or marketing grant is usable until current-session server evidence arrives. */
export function getVerifiedConsent(): VerifiedConsentState {
  return current ?? DENIED;
}

export function applyServerConsent(snapshot: ConsentServerSnapshot): VerifiedConsentState {
  current = snapshot.decided
    ? {
        essential: true,
        analytics: snapshot.analytics,
        marketing: snapshot.marketing,
        personalization: snapshot.personalization,
      }
    : DENIED;
  return current;
}

/** Fail closed while a new choice is being saved or the session is rechecked. */
export function beginConsentUpdate(): void {
  current = null;
}

export function clearVerifiedConsent(): void {
  current = DENIED;
}
