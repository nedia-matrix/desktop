import { randomUUID } from "node:crypto";
import type {
  AutomationExecutionTrace,
  AutomationTraceEvent,
} from "@nedia-matrix/automation-engine";

import type {
  AutomationLogComponent,
  AutomationLogLevel,
  AutomationLogSink,
  AutomationOperation,
} from "./automation-log-record.js";

export interface AutomationTraceStartContext {
  readonly operation: AutomationOperation;
  readonly platformId?: string;
  readonly accountId?: string;
  readonly requestId?: string;
}

export interface AutomationTraceBinding {
  readonly platformId?: string;
  readonly accountId?: string;
  readonly requestId?: string;
  readonly publicationId?: string;
  readonly pageId?: string;
}

export interface AutomationDiagnosticEvent {
  readonly component: AutomationLogComponent;
  readonly event: string;
  readonly level?: AutomationLogLevel;
  readonly executionId?: string;
  readonly workflowId?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface AutomationDiagnosticTrace {
  readonly traceId: string;
  bind(binding: AutomationTraceBinding): void;
  report(event: AutomationDiagnosticEvent): void;
  execution(phase: string): AutomationExecutionTrace;
  finish(input: { outcome: string; message?: string }): void;
}

interface ActiveTrace {
  sequence: number;
  finished: boolean;
  finishedAt?: number;
  context: AutomationTraceStartContext & AutomationTraceBinding;
}

const FINISHED_TRACE_TTL_MS = 30 * 60 * 1_000;
const MAX_FINISHED_TRACES = 1_024;

export class AutomationTraceService {
  private readonly traces = new Map<string, ActiveTrace>();
  private readonly publicationIndex = new Map<string, string>();

  constructor(
    private readonly sink: AutomationLogSink,
    private readonly now: () => Date = () => new Date(),
  ) {}

  start(context: AutomationTraceStartContext): AutomationDiagnosticTrace {
    this.pruneFinished();
    const traceId = randomUUID();
    const state: ActiveTrace = {
      sequence: 0,
      finished: false,
      context: { ...context },
    };
    this.traces.set(traceId, state);
    const trace = this.createHandle(traceId, state);
    trace.report({
      component: "application",
      event: "automation.started",
      details: {},
    });
    return trace;
  }

  async findTraceForPublication(publicationId: string): Promise<string | null> {
    return (
      this.publicationIndex.get(publicationId) ??
      (await this.sink.findTraceForPublication(publicationId))
    );
  }

  flush(): Promise<void> {
    return this.sink.flush();
  }

  close(): Promise<void> {
    return this.sink.close();
  }

  activeTraceIds(): ReadonlySet<string> {
    return new Set(
      [...this.traces.entries()]
        .filter(([, trace]) => !trace.finished)
        .map(([traceId]) => traceId),
    );
  }

  reportDroppedRecords(
    traceId: string,
    counts: Readonly<Record<AutomationLogLevel, number>>,
  ): void {
    const state = this.traces.get(traceId);
    if (!state) return;
    this.report(traceId, state, {
      component: "logger",
      event: "logger.records_dropped",
      level: "warn",
      details: {
        count: Object.values(counts).reduce((sum, value) => sum + value, 0),
        ...counts,
      },
    });
  }

  private createHandle(
    traceId: string,
    state: ActiveTrace,
  ): AutomationDiagnosticTrace {
    return {
      traceId,
      bind: (binding) => {
        if (state.finished) return;
        state.context = { ...state.context, ...binding };
        if (binding.publicationId) {
          this.publicationIndex.set(binding.publicationId, traceId);
        }
      },
      report: (event) => this.report(traceId, state, event),
      execution: (phase) => {
        const executionId = randomUUID();
        return {
          executionId,
          report: (event) =>
            this.reportEngineEvent(traceId, state, executionId, phase, event),
        };
      },
      finish: ({ outcome, message }) => {
        if (state.finished) return;
        this.report(traceId, state, {
          component: "application",
          event:
            outcome === "failed" ? "automation.failed" : "automation.completed",
          level: outcome === "failed" ? "error" : "info",
          details: { outcome, ...(message ? { message } : {}) },
        });
        state.finished = true;
        state.finishedAt = this.now().getTime();
      },
    };
  }

  private reportEngineEvent(
    traceId: string,
    state: ActiveTrace,
    executionId: string,
    phase: string,
    event: AutomationTraceEvent,
  ): void {
    const { workflowId } = event;
    const details: Record<string, unknown> = { phase };
    for (const [key, value] of Object.entries(event)) {
      if (key === "type" || key === "workflowId") continue;
      details[key] = value;
    }
    this.report(traceId, state, {
      component: event.type.startsWith("evidence.") ? "evidence" : "workflow",
      event: event.type,
      executionId,
      workflowId,
      level: levelForEngineEvent(event),
      details,
    });
  }

  private report(
    traceId: string,
    state: ActiveTrace,
    event: AutomationDiagnosticEvent,
  ): void {
    const context = state.context;
    this.sink.report({
      timestamp: this.now().toISOString(),
      level: event.level ?? "info",
      sequence: ++state.sequence,
      traceId,
      operation: context.operation,
      component: event.component,
      event: event.event,
      ...(event.executionId ? { executionId: event.executionId } : {}),
      ...(context.platformId ? { platformId: context.platformId } : {}),
      ...(context.accountId ? { accountId: context.accountId } : {}),
      ...(context.requestId ? { requestId: context.requestId } : {}),
      ...(context.publicationId
        ? { publicationId: context.publicationId }
        : {}),
      ...(context.pageId ? { pageId: context.pageId } : {}),
      ...(event.workflowId ? { workflowId: event.workflowId } : {}),
      ...(event.details
        ? {
            details: {
              ...event.details,
              ...(state.finished ? { late: true } : {}),
            },
          }
        : state.finished
          ? { details: { late: true } }
          : {}),
    });
  }

  private pruneFinished(): void {
    const cutoff = this.now().getTime() - FINISHED_TRACE_TTL_MS;
    const finished = [...this.traces.entries()].filter(
      ([, trace]) => trace.finished,
    );
    for (const [traceId, trace] of finished) {
      if ((trace.finishedAt ?? 0) < cutoff) this.removeTrace(traceId);
    }
    const remainingFinished = [...this.traces.entries()].filter(
      ([, trace]) => trace.finished,
    );
    for (const [traceId] of remainingFinished.slice(
      0,
      Math.max(0, remainingFinished.length - MAX_FINISHED_TRACES),
    )) {
      this.removeTrace(traceId);
    }
  }

  private removeTrace(traceId: string): void {
    this.traces.delete(traceId);
    for (const [publicationId, indexedTraceId] of this.publicationIndex) {
      if (indexedTraceId === traceId)
        this.publicationIndex.delete(publicationId);
    }
  }
}

function levelForEngineEvent(event: AutomationTraceEvent): AutomationLogLevel {
  if (event.type.endsWith("failed")) return "error";
  if (event.type === "evidence.capture_failed") return "warn";
  if (event.type.startsWith("target.")) return "debug";
  return "info";
}
