import { ApplicationError } from "../../shared/application/application-error";

// Drizzle may wrap a binding error in a query error. Never return either raw
// message: query parameters and provider payloads can contain private data.
export function databaseDailyLimitError(error: unknown, now: number): ApplicationError | null {
  let current = error;
  for (let depth = 0; depth < 8 && current instanceof Error; depth++) {
    if (current instanceof ApplicationError && current.code === "DATABASE_DAILY_LIMIT_REACHED")
      return current;
    if (/exceeded D1's free tier daily row (read|write) limit/i.test(current.message)) {
      const resetAt = Math.floor(now / 86_400_000) * 86_400_000 + 86_400_000 + 5000;
      return new ApplicationError(
        "DATABASE_DAILY_LIMIT_REACHED",
        "The daily database limit is exhausted. Collection can resume after 00:00 UTC.",
        resetAt - now,
      );
    }
    current = current.cause;
  }
  return null;
}
