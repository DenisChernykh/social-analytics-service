export type ErrorCode =
  | "NOT_FOUND"
  | "UNAUTHENTICATED"
  | "VALIDATION_FAILED"
  | "CONFIGURATION_REQUIRED"
  | "INSTAGRAM_AUTH_EXPIRED"
  | "INSTAGRAM_PERMISSION_REQUIRED"
  | "INSTAGRAM_RATE_LIMITED"
  | "INSTAGRAM_UNAVAILABLE"
  | "INVALID_OAUTH_STATE"
  | "OAUTH_DENIED"
  | "SYNC_IN_PROGRESS"
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
