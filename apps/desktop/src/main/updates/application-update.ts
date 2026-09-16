import type { ApplicationUpdateCheckResult } from "../../bridge/contracts.js";

const RELEASE_REPOSITORY_URL = "https://github.com/nedia-matrix/desktop";
const LATEST_RELEASE_API_URL =
  "https://api.github.com/repos/nedia-matrix/desktop/releases/latest";
const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)$/;
const UPDATE_CHECK_TIMEOUT_MS = 8_000;

export interface ApplicationRelease {
  version: string;
}

export interface ApplicationUpdateDependencies {
  currentVersion: string;
  findLatestRelease(): Promise<ApplicationRelease>;
}

type NumericVersion = readonly [major: number, minor: number, patch: number];

function parseVersion(version: string): NumericVersion | null {
  const match = VERSION_PATTERN.exec(version);
  if (!match) return null;

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isNewerVersion(
  candidateVersion: string,
  currentVersion: string,
): boolean {
  const candidate = parseVersion(candidateVersion);
  const current = parseVersion(currentVersion);
  if (!candidate || !current) return false;

  const [candidateMajor, candidateMinor, candidatePatch] = candidate;
  const [currentMajor, currentMinor, currentPatch] = current;
  if (candidateMajor !== currentMajor) return candidateMajor > currentMajor;
  if (candidateMinor !== currentMinor) return candidateMinor > currentMinor;
  return candidatePatch > currentPatch;
}

function releaseFromTag(tag: unknown): ApplicationRelease | null {
  if (typeof tag !== "string" || !VERSION_PATTERN.test(tag)) return null;
  return {
    version: tag.replace(/^v/, ""),
  };
}

export function releasePageUrl(version: string): string | null {
  const parsedVersion = parseVersion(version);
  if (!parsedVersion) return null;

  return `${RELEASE_REPOSITORY_URL}/releases/tag/v${parsedVersion.join(".")}`;
}

export async function findLatestRelease(
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<ApplicationRelease> {
  const response = await fetcher(LATEST_RELEASE_API_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "NediaMatrix-update-check",
    },
    signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Latest release request returned HTTP ${response.status}`);
  }

  const payload: unknown = await response.json();
  const tag =
    typeof payload === "object" && payload !== null && "tag_name" in payload
      ? payload.tag_name
      : undefined;
  const release = releaseFromTag(tag);
  if (!release) {
    throw new Error(
      "Latest release response does not contain a stable version tag",
    );
  }
  return release;
}

export async function checkForApplicationUpdate(
  dependencies: ApplicationUpdateDependencies,
): Promise<ApplicationUpdateCheckResult> {
  const latestRelease = await dependencies.findLatestRelease();
  if (!isNewerVersion(latestRelease.version, dependencies.currentVersion)) {
    return {
      status: "up-to-date",
      currentVersion: dependencies.currentVersion,
    };
  }

  return {
    status: "update-available",
    currentVersion: dependencies.currentVersion,
    latestVersion: latestRelease.version,
  };
}
