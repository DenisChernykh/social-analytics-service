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
