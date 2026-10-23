// A failure of one object's insights must not suspend unrelated account work.
// These delays never imply that the object was deleted or a field unsupported.
export function objectFailureDelay(code: string): number | null {
  switch (code) {
    case "INSTAGRAM_SOURCE_ERROR":
      return 5 * 60_000;
    case "INSTAGRAM_INVALID_REQUEST":
    case "INSTAGRAM_INVALID_BREAKDOWN":
      return 60 * 60_000;
    case "INSTAGRAM_OBJECT_UNAVAILABLE":
      return 24 * 60 * 60_000;
    default:
      return null;
  }
}

// A successful observation clears availability. Repeated object failures back
// off independently, without suspending the account or declaring a metric unsupported.
export function nextObjectFailureDelay(
  code: string,
  requestedDelayMs: number,
  previous?: { errorCode: string | null; retryDelayMs?: number },
): number {
  const base = objectFailureDelay(code) ?? requestedDelayMs;
  const previousDelay = previous?.errorCode === code ? (previous.retryDelayMs ?? 0) : 0;
  return Math.max(requestedDelayMs, Math.min(86_400_000, Math.max(base, previousDelay * 2)));
}
