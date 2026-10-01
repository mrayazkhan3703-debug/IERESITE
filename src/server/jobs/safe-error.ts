/** Monitoring responses show failure presence without provider bodies or PII. */
export function safeOperationalError(error: string | null): string | null {
  return error ? "Processing failed. Review the protected server logs for details." : null;
}
