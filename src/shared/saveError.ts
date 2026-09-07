/** Preserve whether retrying the exact same draft can succeed. */
export class SaveError extends Error {
  constructor(
    message: string,
    readonly retryable = true
  ) {
    super(message);
    this.name = "SaveError";
  }
}

export function canRetrySave(error: unknown): boolean {
  if (error instanceof SaveError) return error.retryable;
  if (error instanceof Error && error.name === "QuotaExceededError") return false;
  return true;
}
