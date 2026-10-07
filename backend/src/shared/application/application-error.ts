export type ErrorCode =
  | "NOT_FOUND"
  | "UNAUTHENTICATED"
  | "VALIDATION_FAILED"
  | "CONFIGURATION_REQUIRED"
  | "INSTAGRAM_AUTH_EXPIRED"
  | "INSTAGRAM_PERMISSION_REQUIRED"
  | "INSTAGRAM_RATE_LIMITED"
  | "INSTAGRAM_UNAVAILABLE"
  | "INSTAGRAM_PAGINATION_STALLED"
  | "INVALID_OAUTH_STATE"
  | "OAUTH_DENIED"
  | "SYNC_IN_PROGRESS"
  | "SYNC_LEASE_EXPIRED"
  | "COLLECTION_EXPIRED"
  | "INTERNAL_ERROR"
  | "OPERATION_CONFLICT";

export class ApplicationError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApplicationError";
  }
}

// Persisted operations contain stable codes, never raw provider error messages.
// Keep interruptions distinct from an upstream outage when resuming a page.
export function incompleteOperationError(status: string, code: string | null): ApplicationError {
  if (status === "running")
    return new ApplicationError("SYNC_IN_PROGRESS", "The collection operation is still running.");
  switch (code) {
    case "NOT_FOUND":
    case "CONFIGURATION_REQUIRED":
    case "INSTAGRAM_AUTH_EXPIRED":
    case "INSTAGRAM_PERMISSION_REQUIRED":
    case "INSTAGRAM_RATE_LIMITED":
    case "INSTAGRAM_UNAVAILABLE":
    case "INSTAGRAM_PAGINATION_STALLED":
    case "SYNC_IN_PROGRESS":
    case "SYNC_LEASE_EXPIRED":
    case "COLLECTION_EXPIRED":
    case "OPERATION_CONFLICT":
    case "VALIDATION_FAILED":
      return new ApplicationError(code, "The saved collection operation did not complete.");
    default:
      return new ApplicationError("INTERNAL_ERROR", "The saved collection operation failed.");
  }
}
