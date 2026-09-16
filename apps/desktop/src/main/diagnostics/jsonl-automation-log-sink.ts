import { appendFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import type {
  AutomationLogLevel,
  AutomationLogSink,
  PendingAutomationLogRecord,
} from "./automation-log-record.js";
import { redactAutomationLogRecord } from "./automation-log-redaction.js";
import { enforceAutomationDiagnosticRetention } from "./automation-diagnostic-retention.js";

const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_QUEUE_SIZE = 4_096;
const LOG_FILE_PATTERN = /^automation-(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.jsonl$/;

interface QueuedRecord {
  readonly traceId: string;
  readonly level: AutomationLogLevel;
  readonly line: string;
  readonly bytes: number;
}

export interface JsonlAutomationLogSinkOptions {
  readonly directory: string;
  readonly maxFileBytes?: number;
  readonly maxQueueSize?: number;
  readonly now?: () => Date;
  readonly onError?: (error: unknown) => void;
  readonly evidenceDirectory?: string;
  readonly protectedTraceIds?: () => ReadonlySet<string>;
  readonly onRecordsDropped?: (
    traceId: string,
    counts: Readonly<Record<AutomationLogLevel, number>>,
  ) => void;
}

export class JsonlAutomationLogSink implements AutomationLogSink {
  private readonly queue: QueuedRecord[] = [];
  private readonly dropped = new Map<
    string,
    Record<AutomationLogLevel, number>
  >();
  private readonly initialization: Promise<void>;
  private draining: Promise<void> | undefined;
  private closed = false;
  private disabled = false;
  private reportedError = false;
  private activeDate = "";
  private activeIndex = 0;
  private activeSize = 0;
  private retentionDate = "";

  constructor(private readonly options: JsonlAutomationLogSinkOptions) {
    this.initialization = this.initialize();
  }

  report(pending: PendingAutomationLogRecord): void {
    if (this.closed || this.disabled) return;
    let line: string;
    try {
      line = `${JSON.stringify(redactAutomationLogRecord(pending))}\n`;
    } catch (error) {
      this.reportError(error);
      return;
    }
    const queued: QueuedRecord = {
      traceId: pending.traceId,
      level: pending.level,
      line,
      bytes: Buffer.byteLength(line, "utf8"),
    };
    const capacity = this.options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
    if (
      this.queue.length >= Math.floor(capacity * 0.75) &&
      pending.level === "debug"
    ) {
      this.noteDropped(pending.traceId, pending.level);
      return;
    }
    if (this.queue.length >= capacity) {
      const replaceable =
        pending.level === "warn" || pending.level === "error"
          ? this.queue.findIndex(
              ({ level }) => level === "debug" || level === "info",
            )
          : -1;
      if (replaceable < 0) {
        this.noteDropped(pending.traceId, pending.level);
        return;
      }
      const [removed] = this.queue.splice(replaceable, 1);
      if (removed) this.noteDropped(removed.traceId, removed.level);
    }
    this.queue.push(queued);
    this.startDrain();
  }

  async flush(): Promise<void> {
    while (this.draining) await this.draining;
    if (this.queue.length > 0 && !this.disabled) {
      this.startDrain();
      while (this.draining) await this.draining;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.flush();
  }

  async findTraceForPublication(publicationId: string): Promise<string | null> {
    if (!/^[A-Za-z0-9._~-]{1,128}$/.test(publicationId)) {
      throw new TypeError("Invalid publication ID");
    }
    await this.flush();
    let names: string[];
    try {
      names = (await readdir(this.options.directory))
        .filter((name) => LOG_FILE_PATTERN.test(name))
        .sort()
        .reverse();
    } catch {
      return null;
    }
    for (const name of names) {
      const contents = await readFile(
        join(this.options.directory, name),
        "utf8",
      );
      const lines = contents.split("\n");
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index];
        if (!line || !line.includes(publicationId)) continue;
        try {
          const record = JSON.parse(line) as {
            publicationId?: unknown;
            traceId?: unknown;
          };
          if (
            record.publicationId === publicationId &&
            typeof record.traceId === "string"
          ) {
            return record.traceId;
          }
        } catch {
          // Ignore a partial tail or a damaged diagnostic record.
        }
      }
    }
    return null;
  }

  private startDrain(): void {
    if (this.draining || this.queue.length === 0 || this.disabled) return;
    this.draining = this.drain().finally(() => {
      this.draining = undefined;
      if (this.queue.length > 0 && !this.closed && !this.disabled) {
        this.startDrain();
      }
    });
  }

  private async drain(): Promise<void> {
    try {
      await this.initialization;
      if (this.disabled) return;
      while (this.queue.length > 0) {
        const record = this.queue.shift()!;
        await this.prepareFile(record.bytes);
        await appendFile(this.activePath(), record.line, "utf8");
        this.activeSize += record.bytes;
      }
      this.emitDroppedRecords();
    } catch (error) {
      this.disabled = true;
      this.queue.length = 0;
      this.reportError(error);
    }
  }

  private async initialize(): Promise<void> {
    const today = this.dateKey();
    try {
      await mkdir(this.options.directory, { recursive: true });
      await this.selectActiveFile(today);
    } catch (error) {
      this.disabled = true;
      this.reportError(error);
      return;
    }
    await this.enforceRetention(today, true);
  }

  private async prepareFile(nextBytes: number): Promise<void> {
    const today = this.dateKey();
    if (this.activeDate !== today) {
      await this.selectActiveFile(today);
      await this.enforceRetention(today);
    }
    const maxBytes = this.options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    if (this.activeSize > 0 && this.activeSize + nextBytes > maxBytes) {
      this.activeIndex += 1;
      this.activeSize = await fileSize(this.activePath());
      await this.enforceRetention(today, true);
    }
  }

  private async selectActiveFile(today: string): Promise<void> {
    this.activeDate = today;
    let names: string[] = [];
    try {
      names = await readdir(this.options.directory);
    } catch {
      // The directory is created by drain before this method is called.
    }
    const indexes = names.flatMap((name) => {
      const match = LOG_FILE_PATTERN.exec(name);
      if (!match || match[1] !== today) return [];
      return [Number(match[2] ?? 0)];
    });
    this.activeIndex = indexes.length > 0 ? Math.max(...indexes) : 0;
    this.activeSize = await fileSize(this.activePath());
    const maxBytes = this.options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    if (this.activeSize >= maxBytes) {
      this.activeIndex += 1;
      this.activeSize = await fileSize(this.activePath());
    }
  }

  private activePath(): string {
    const suffix = this.activeIndex === 0 ? "" : `.${this.activeIndex}`;
    return join(
      this.options.directory,
      `automation-${this.activeDate}${suffix}.jsonl`,
    );
  }

  private dateKey(): string {
    return (this.options.now ?? (() => new Date()))()
      .toISOString()
      .slice(0, 10);
  }

  private noteDropped(traceId: string, level: AutomationLogLevel): void {
    const counts = this.dropped.get(traceId) ?? {
      debug: 0,
      info: 0,
      warn: 0,
      error: 0,
    };
    counts[level] += 1;
    this.dropped.set(traceId, counts);
  }

  private emitDroppedRecords(): void {
    if (!this.options.onRecordsDropped || this.dropped.size === 0) return;
    const dropped = [...this.dropped.entries()];
    this.dropped.clear();
    for (const [traceId, counts] of dropped) {
      try {
        this.options.onRecordsDropped(traceId, counts);
      } catch {
        // A diagnostic about dropped diagnostics must not stop the writer.
      }
    }
  }

  private async enforceRetention(today: string, force = false): Promise<void> {
    if (!force && this.retentionDate === today) return;
    this.retentionDate = today;
    try {
      await enforceAutomationDiagnosticRetention({
        logDirectory: this.options.directory,
        evidenceDirectory:
          this.options.evidenceDirectory ??
          join(this.options.directory, "..", "automation-evidence"),
        activeLogPath: this.activePath(),
        protectedTraceIds: this.options.protectedTraceIds?.(),
        now: () => (this.options.now ?? (() => new Date()))().getTime(),
      });
    } catch (error) {
      this.reportError(error);
    }
  }

  private reportError(error: unknown): void {
    if (this.reportedError) return;
    this.reportedError = true;
    this.options.onError?.(error);
  }
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}
