import { z } from "zod";

/** Provider prompts must include the same types, enums and bounds enforced by tools. */
export function advisorToolContract(schema: z.ZodType): string {
  const { $schema: _dialect, ...contract } = z.toJSONSchema(schema, { io: "input" });
  void _dialect;
  return JSON.stringify(contract);
}
