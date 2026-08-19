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
    contentForm: "video" | "imageText";
    submissionModes: Array<"automatic" | "manual_confirmation">;
  }>;
}
