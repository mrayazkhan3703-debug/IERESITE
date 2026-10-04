import { expect, test } from "bun:test";
import { approvedKnowledgeInstruction } from "@/server/ai/knowledge-context";
test("knowledge capability wording states missing sources or uses the existing cited knowledge tool", () => {
  expect(approvedKnowledgeInstruction(false)).toContain("No approved current knowledge documents");
  expect(approvedKnowledgeInstruction(true)).toContain("Use search_knowledge");
  expect(approvedKnowledgeInstruction(true)).toContain("does not independently verify inventory");
});
