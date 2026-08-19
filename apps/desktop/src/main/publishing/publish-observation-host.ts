import { randomUUID } from "node:crypto";

import type { PublishResultUpdate } from "@nedia-matrix/ipc-contracts";
import type {
  PublishResultEvent,
  PublishResultMonitor,
} from "@nedia-matrix/platform-core";

export interface HostedPublishObservation {
  readonly id: string;
  ready(): Promise<void>;
  arm(): void;
  stop(): void;
}

export interface PublishObservationEvent {
  observationId: string;
  publicationId: string;
  accountId: string;
  platformId: string;
  result: PublishResultEvent;
}

export function toPublishResultUpdate(
  event: PublishObservationEvent,
): PublishResultUpdate {
  const result = event.result;
  return {
    observationId: event.observationId,
    publicationId: event.publicationId,
    accountId: event.accountId,
    status: result.kind,
    message: result.kind === "published" ? "发布成功" : result.message,
    platformContentId: result.kind === "published" ? result.contentId : null,
    platformContentUrl: result.kind === "published" ? result.contentUrl : null,
  };
}

export class PublishObservationHost {
  private readonly observations = new Map<string, HostedPublishObservation>();

  constructor(
    private readonly onEvent: (event: PublishObservationEvent) => void,
  ) {}

  attach(input: {
    publicationId: string;
    accountId: string;
    platformId: string;
    monitor: PublishResultMonitor;
    onFinished?: () => void;
  }): HostedPublishObservation {
    this.stop(input.accountId);
    const id = randomUUID();
    let stopped = false;
    let armed = false;
    let completed = false;
    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      input.onFinished?.();
    };
    const unsubscribe = input.monitor.subscribe((result) => {
      this.onEvent({
        observationId: id,
        publicationId: input.publicationId,
        accountId: input.accountId,
        platformId: input.platformId,
        result,
      });
      if (
        result.kind === "published" ||
        result.kind === "failed" ||
        result.kind === "uncertain"
      ) {
        completed = true;
        unsubscribe();
        this.observations.delete(input.accountId);
        finish();
      }
    });
    const hosted: HostedPublishObservation = {
      id,
      ready: () => input.monitor.ready(),
      arm: () => {
        input.monitor.arm();
        armed = true;
      },
      stop: () => {
        if (stopped) return;
        stopped = true;
        if (armed && !completed) {
          this.onEvent({
            observationId: id,
            publicationId: input.publicationId,
            accountId: input.accountId,
            platformId: input.platformId,
            result: {
              kind: "uncertain",
              message: "发布结果监听已中断，请先在平台核实后再决定是否重试",
            },
          });
        }
        unsubscribe();
        input.monitor.stop();
        if (this.observations.get(input.accountId) === hosted) {
          this.observations.delete(input.accountId);
        }
        finish();
      },
    };
    this.observations.set(input.accountId, hosted);
    return hosted;
  }

  stop(accountId: string): void {
    this.observations.get(accountId)?.stop();
  }

  stopAll(): void {
    for (const observation of [...this.observations.values()]) {
      observation.stop();
    }
  }
}
