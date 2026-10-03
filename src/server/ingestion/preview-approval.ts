import { HttpError } from "@/server/auth";

export type ImportPreview = {
  dryRun: boolean;
  status: string;
  triggeredBy: string | null;
  snapshotSha256: string | null;
  inputFormat: string | null;
  recordsTotal: number;
  recordCursor: number;
};

/** Approval binds the reviewed immutable snapshot to its submitting administrator. */
export function requireReviewedImport(preview: ImportPreview | null, input: { email: string; sha256: string; format: string }) {
  if (!preview || !preview.dryRun || preview.status !== "DRY_RUN" || preview.recordsTotal < 1 || preview.recordCursor !== preview.recordsTotal) {
    throw new HttpError(409, "Complete and review validation before committing this import.", "IMPORT_PREVIEW_REQUIRED");
  }
  if (preview.triggeredBy !== input.email || preview.snapshotSha256 !== input.sha256 || preview.inputFormat !== input.format) {
    throw new HttpError(409, "The preview does not match this administrator and file. Validate again.", "IMPORT_PREVIEW_MISMATCH");
  }
}
