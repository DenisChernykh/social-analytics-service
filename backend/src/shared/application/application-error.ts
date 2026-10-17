export type ErrorCode =
  | "NOT_FOUND"
  | "UNAUTHENTICATED"
  | "VALIDATION_FAILED"
  | "FEATURE_UNAVAILABLE"
  | "CONFIGURATION_REQUIRED"
  | "INSTAGRAM_AUTH_EXPIRED"
  | "INSTAGRAM_PERMISSION_REQUIRED"
  | "INSTAGRAM_RATE_LIMITED"
  | "INSTAGRAM_UNAVAILABLE"
  | "INSTAGRAM_INVALID_REQUEST"
  | "INSTAGRAM_INVALID_BREAKDOWN"
  | "INSTAGRAM_SOURCE_ERROR"
  | "REQUEST_BUDGET_EXHAUSTED"
  | "INSTAGRAM_OBJECT_UNAVAILABLE"
  | "INSTAGRAM_PAGINATION_STALLED"
  | "INVALID_OAUTH_STATE"
  | "OAUTH_DENIED"
  | "SYNC_IN_PROGRESS"
  | "SYNC_LEASE_EXPIRED"
  | "COLLECTION_EXPIRED"
  | "INTERNAL_ERROR"
  | "OPERATION_CONFLICT";

export class ApplicationError extends Error {
  receipt?: import("../domain/measurement").ReceiptReference;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly retryAfterMs?: number,
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
    case "INSTAGRAM_INVALID_REQUEST":
    case "INSTAGRAM_INVALID_BREAKDOWN":
    case "INSTAGRAM_SOURCE_ERROR":
    case "REQUEST_BUDGET_EXHAUSTED":
    case "INSTAGRAM_OBJECT_UNAVAILABLE":
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

// A retry keeps the logical operation identity; transport attempts have their own receipts.
export function retryableOperation(code: string | null) {
  return (
    code !== null &&
    [
      "INSTAGRAM_UNAVAILABLE",
      "INSTAGRAM_RATE_LIMITED",
      "INSTAGRAM_AUTH_EXPIRED",
      "INSTAGRAM_PERMISSION_REQUIRED",
      "REQUEST_BUDGET_EXHAUSTED",
      "SYNC_LEASE_EXPIRED",
      "COLLECTION_EXPIRED",
      "SYNC_IN_PROGRESS",
      "INTERNAL_ERROR",
    ].includes(code)
  );
}
