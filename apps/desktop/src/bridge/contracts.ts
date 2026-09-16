import type {
  SubmissionMode,
  SupportedPublishContentForm,
} from "@nedia-matrix/publishing";

export interface PlatformLoginEntrySummary {
  id: string;
  displayName: string;
  url: string;
}

export interface PlatformSummary {
  id: string;
  displayName: string;
  entryUrl: string;
  rulesVersion: string;
  implementationStatus:
    "route-only" | "reference-derived" | "fixture-tested" | "live-tested";
  loginEntries: PlatformLoginEntrySummary[];
  publishCapabilities: Array<{
    contentForm: SupportedPublishContentForm;
    submissionModes: SubmissionMode[];
    constraints: {
      titleMaxLength?: number;
      bodyMaxLength?: number;
      mediaMaxCount?: number;
    };
    tagPolicy?: {
      placement: "inline" | "new-lines";
      maxCount?: number;
    };
    descriptionComposition?: {
      parts: Array<"title" | "body">;
      separator: string;
    };
  }>;
}

export interface LocalRuntimeStatus {
  status: "running" | "stopped";
  version: string | null;
  host: "127.0.0.1";
  port: number | null;
}

export interface SetLocalRuntimeRunningRequest {
  running: boolean;
}

export type ApplicationUpdateCheckResult =
  | {
      status: "up-to-date";
      currentVersion: string;
    }
  | {
      status: "update-available";
      currentVersion: string;
      latestVersion: string;
    };

export interface OpenApplicationUpdateDownloadRequest {
  version: string;
}

export interface FindAutomationTraceRequest {
  publicationId: string;
}

export interface AutomationTraceReference {
  traceId: string;
}
