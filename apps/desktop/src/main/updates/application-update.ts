import type { ApplicationUpdateCheckResult } from "../../bridge/contracts.js";

declare const __NEDIA_UPDATE_SOURCE__: string;

export type ApplicationUpdateSource = "github" | "gitee";

const UPDATE_SOURCES = {
  github: {
    latestReleaseApiUrl:
      "https://api.github.com/repos/nedia-matrix/desktop/releases/latest",
    releasePageUrl: (tag: string) =>
      `https://github.com/nedia-matrix/desktop/releases/tag/${tag}`,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "NediaMatrix-update-check",
    },
  },
  gitee: {
    latestReleaseApiUrl:
      "https://gitee.com/api/v5/repos/nedia-matrix/desktop/releases/latest",
    releasePageUrl: (tag: string) =>
      `https://gitee.com/nedia-matrix/desktop/releases#release-${tag}`,
    headers: {
      Accept: "application/json",
      "User-Agent": "NediaMatrix-update-check",
    },
  },
} as const satisfies Record<
  ApplicationUpdateSource,
  {
    latestReleaseApiUrl: string;
    releasePageUrl(tag: string): string;
    headers: Readonly<Record<string, string>>;
  }
>;

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)$/;
const UPDATE_CHECK_TIMEOUT_MS = 8_000;

function configuredUpdateSource(): ApplicationUpdateSource {
  if (
    typeof __NEDIA_UPDATE_SOURCE__ !== "undefined" &&
    __NEDIA_UPDATE_SOURCE__ === "gitee"
  ) {
    return "gitee";
  }
  return "github";
}

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

export function releasePageUrl(
  version: string,
  source: ApplicationUpdateSource = configuredUpdateSource(),
): string | null {
  const parsedVersion = parseVersion(version);
  if (!parsedVersion) return null;

  return UPDATE_SOURCES[source].releasePageUrl(`v${parsedVersion.join(".")}`);
}

export async function findLatestRelease(
  fetcher: typeof globalThis.fetch = globalThis.fetch,
  source: ApplicationUpdateSource = configuredUpdateSource(),
): Promise<ApplicationRelease> {
  const configuration = UPDATE_SOURCES[source];
  const response = await fetcher(configuration.latestReleaseApiUrl, {
    headers: configuration.headers,
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
