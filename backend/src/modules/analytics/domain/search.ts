export function normalizeSearch(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ru")
    .replaceAll("ё", "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function searchWords(value: string): string[] {
  return [...new Set(normalizeSearch(value).split(" ").filter(Boolean))];
}
