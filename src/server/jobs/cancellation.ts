export type JobCancellationKind = "shutdown" | "timeout";

export class JobCancellationError extends Error {
  constructor(readonly kind: JobCancellationKind, options?: { cause?: unknown }) {
    super(kind === "timeout" ? "Job handler timed out" : "Worker shutdown requested", options);
    this.name = "JobCancellationError";
  }
}

/**
 * Abort a handler on timeout/shutdown, but do not abandon its promise. This
 * keeps its lease owned until cooperative work has settled instead of letting
 * the same job run concurrently on another worker.
 */
export async function runCancellableJob<T>(
  handler: (signal: AbortSignal) => Promise<T>,
  options: { timeoutMs: number; parentSignal?: AbortSignal },
): Promise<T> {
  const controller = new AbortController();
  let kind: JobCancellationKind | null = null;
  const abort = (reason: JobCancellationKind) => {
    if (kind) return;
    kind = reason;
    controller.abort(new JobCancellationError(reason));
  };
  const parentSignal = options.parentSignal;
  const abortFromParent = () => abort("shutdown");

  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener("abort", abortFromParent, { once: true });

  const timeout = setTimeout(() => abort("timeout"), options.timeoutMs);
  try {
    if (kind) throw new JobCancellationError(kind);
    const value = await handler(controller.signal);
    if (kind) throw new JobCancellationError(kind);
    return value;
  } catch (error) {
    if (kind) throw new JobCancellationError(kind, { cause: error });
    throw error;
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}
