export const platformManifestLimits = {
  allowedHostSuffixes: 16,
  loginEntries: 16,
  fieldPathDepth: 16,
  workflowSteps: 100,
  conditionDepth: 8,
  conditionNodes: 128,
  responseBytes: 2_000_000,
  verificationTimeoutMinMs: 5_000,
  verificationTimeoutMaxMs: 180_000,
} as const;
