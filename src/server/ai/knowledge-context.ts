/** Capability wording follows measured index availability, not configured integrations. */
export function approvedKnowledgeInstruction(available: boolean) {
  return available
    ? "Approved current knowledge is indexed for this language. Use search_knowledge and cite returned passages before making sourced claims; approval does not independently verify inventory."
    : "No approved current knowledge documents are indexed for this language. State this explicitly when describing your capabilities or discussing regulations. Do not say recorded inventory came from approved channels. You can still search recorded inventory and calculate scenarios; do not invent regulatory guidance or citations.";
}
