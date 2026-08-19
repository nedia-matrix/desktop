export interface LocalRuntimeRequestLog {
  id: number;
  timestamp: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  origin: string | null;
  errorCode: string | null;
}

export interface LocalRuntimeDiagnostics {
  status: "running" | "stopped";
  version: string | null;
  host: "127.0.0.1";
  port: number | null;
  requests: readonly LocalRuntimeRequestLog[];
}
