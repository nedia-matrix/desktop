export type AutomationLogLevel = "debug" | "info" | "warn" | "error";

export type AutomationOperation =
  "publish" | "account_verification" | "content_sync";

export type AutomationLogComponent =
  | "application"
  | "browser"
  | "session"
  | "content"
  | "workflow"
  | "monitor"
  | "evidence"
  | "logger";

export interface PendingAutomationLogRecord {
  readonly timestamp: string;
  readonly level: AutomationLogLevel;
  readonly sequence: number;
  readonly traceId: string;
  readonly executionId?: string;
  readonly operation: AutomationOperation;
  readonly component: AutomationLogComponent;
  readonly event: string;
  readonly platformId?: string;
  readonly accountId?: string;
  readonly requestId?: string;
  readonly publicationId?: string;
  readonly pageId?: string;
  readonly workflowId?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface AutomationLogRecord extends PendingAutomationLogRecord {
  readonly schemaVersion: 1;
}

export interface AutomationLogSink {
  report(record: PendingAutomationLogRecord): void;
  flush(): Promise<void>;
  close(): Promise<void>;
  findTraceForPublication(publicationId: string): Promise<string | null>;
}
