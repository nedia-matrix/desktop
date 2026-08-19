export function parseWebOrigin(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password || url.origin !== value) return null;
    return url.origin;
  } catch {
    return null;
  }
}
