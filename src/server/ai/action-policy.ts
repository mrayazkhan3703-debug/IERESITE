const DISABLED_ADVISOR_ACTIONS = new Set(["capture_lead", "human_handoff"]);

/** Actions stay blocked until trusted consent and a durable operational command exist. */
export function isDisabledAdvisorAction(toolName: string): boolean {
  return DISABLED_ADVISOR_ACTIONS.has(toolName);
}
