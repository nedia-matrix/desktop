import type {
  AutomationLogRecord,
  PendingAutomationLogRecord,
} from "./automation-log-record.js";

const MAX_MESSAGE_LENGTH = 2_048;
const MAX_ID_LENGTH = 256;
export const MAX_AUTOMATION_LOG_RECORD_BYTES = 16 * 1_024;

const allowedDetailKeys = new Set([
  "attemptedCandidates",
  "boundary",
  "browserChannel",
  "code",
  "complete",
  "count",
  "debug",
  "durationMs",
  "elementState",
  "errorName",
  "evidenceId",
  "headless",
  "info",
  "implementationStatus",
  "itemsRead",
  "inputs",
  "kind",
  "late",
  "matchCount",
  "message",
  "outcome",
  "owner",
  "pageDefinitionId",
  "phase",
  "pagesRead",
  "purpose",
  "reason",
  "remoteTotal",
  "selectedCandidateIndex",
  "selectedCandidateKind",
  "source",
  "stateId",
  "stage",
  "status",
  "stepCount",
  "stepIndex",
  "stepKind",
  "truncated",
  "url",
  "warn",
  "error",
  "diagnosticCount",
  "summary",
]);

const allowedNestedKeys = new Set([
  "attached",
  "count",
  "editable",
  "enabled",
  "kind",
  "length",
  "matchCount",
  "attemptedCandidates",
  "selectedCandidateIndex",
  "selectedCandidateKind",
  "outcome",
  "durationMs",
  "elementState",
  "visible",
]);

export function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "invalid-or-relative-url";
  }
}

export function sanitizeMessage(
  value: string,
  maxLength = MAX_MESSAGE_LENGTH,
): string {
  const sanitized = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(
      /\b(cookie|authorization|token|password|secret)\b\s*[:=]\s*[^\s,;]+/gi,
      "$1=[redacted]",
    )
    .replace(/\b1[3-9]\d{9}\b/g, "[phone]")
    .replace(/(?:[A-Za-z]:\\|\\\\)[^\s"']+/g, "[path]")
    .replace(/\/(?:Users|home|var|tmp)\/[^\s"']+/g, "[path]");
  return sanitized.length <= maxLength
    ? sanitized
    : `${sanitized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function sanitizeId(value: string): string {
  return sanitizeMessage(value, MAX_ID_LENGTH);
}

function sanitizeDetails(
  details: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined {
  if (!details) return undefined;
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (!allowedDetailKeys.has(key)) continue;
    const cleaned = sanitizeDetailValue(key, value, 0);
    if (cleaned !== undefined) sanitized[key] = cleaned;
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function sanitizeDetailValue(
  key: string,
  value: unknown,
  depth: number,
): unknown {
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    if (key === "url") return sanitizeUrl(value);
    if (key === "message" || key === "reason") return sanitizeMessage(value);
    return sanitizeId(value);
  }
  if (
    depth >= 3 ||
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return undefined;
  }
  const output: Record<string, unknown> = {};
  for (const [nestedKey, nestedValue] of Object.entries(value)) {
    if (!allowedNestedKeys.has(nestedKey) && key !== "inputs") continue;
    if (key === "inputs" && !/^[A-Za-z0-9._~-]{1,128}$/.test(nestedKey)) {
      continue;
    }
    const cleaned = sanitizeDetailValue(nestedKey, nestedValue, depth + 1);
    if (cleaned !== undefined) output[nestedKey] = cleaned;
  }
  return output;
}

export function redactAutomationLogRecord(
  pending: PendingAutomationLogRecord,
): AutomationLogRecord {
  const details = sanitizeDetails(pending.details);
  const record: AutomationLogRecord = {
    schemaVersion: 1,
    timestamp: new Date(pending.timestamp).toISOString(),
    level: pending.level,
    sequence: pending.sequence,
    traceId: sanitizeId(pending.traceId),
    operation: pending.operation,
    component: pending.component,
    event: sanitizeId(pending.event),
    ...(pending.executionId
      ? { executionId: sanitizeId(pending.executionId) }
      : {}),
    ...(pending.platformId
      ? { platformId: sanitizeId(pending.platformId) }
      : {}),
    ...(pending.accountId ? { accountId: sanitizeId(pending.accountId) } : {}),
    ...(pending.requestId ? { requestId: sanitizeId(pending.requestId) } : {}),
    ...(pending.publicationId
      ? { publicationId: sanitizeId(pending.publicationId) }
      : {}),
    ...(pending.pageId ? { pageId: sanitizeId(pending.pageId) } : {}),
    ...(pending.workflowId
      ? { workflowId: sanitizeId(pending.workflowId) }
      : {}),
    ...(details ? { details } : {}),
  };
  return fitRecord(record);
}

function fitRecord(record: AutomationLogRecord): AutomationLogRecord {
  if (
    Buffer.byteLength(JSON.stringify(record), "utf8") <=
    MAX_AUTOMATION_LOG_RECORD_BYTES
  ) {
    return record;
  }
  const message = record.details?.message;
  const details = {
    ...(record.details ?? {}),
    ...(typeof message === "string"
      ? { message: sanitizeMessage(message, 512) }
      : {}),
    truncated: true,
  };
  const shortened = { ...record, details };
  if (
    Buffer.byteLength(JSON.stringify(shortened), "utf8") <=
    MAX_AUTOMATION_LOG_RECORD_BYTES
  ) {
    return shortened;
  }
  return {
    ...record,
    details: { truncated: true },
  };
}
