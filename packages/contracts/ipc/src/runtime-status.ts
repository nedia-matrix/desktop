export interface LocalRuntimeStatus {
  status: "running" | "stopped";
  version: string | null;
  host: "127.0.0.1";
  port: number | null;
}

export interface SetLocalRuntimeRunningRequest {
  running: boolean;
}
