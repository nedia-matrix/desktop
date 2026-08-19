import { isAbsolute, join } from "node:path";

function normalizeProfileSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-");
  if (normalized.length === 0 || normalized.length > 128) {
    throw new TypeError(
      "Browser profile segment must contain 1-128 safe characters",
    );
  }
  return normalized;
}

export function createBrowserProfileId(
  platformId: string,
  accountId: string,
): string {
  return `matrix-${normalizeProfileSegment(platformId)}-${normalizeProfileSegment(accountId)}`;
}

export function browserProfileDirectory(
  profilesRoot: string,
  profileId: string,
): string {
  if (!isAbsolute(profilesRoot)) {
    throw new TypeError("Browser profiles root must be an absolute path");
  }
  return join(profilesRoot, normalizeProfileSegment(profileId));
}
