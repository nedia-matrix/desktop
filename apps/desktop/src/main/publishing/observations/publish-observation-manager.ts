import { randomUUID } from "node:crypto";

import type { PublishResultUpdate } from "@nedia-matrix/ipc-contracts";
import type {
  PublishInterruptionReason,
  PublishResultEvent,
  PublishResultMonitor,
} from "@nedia-matrix/platform-core";

export interface ManagedPublishObservation {
  readonly id: string;
  ready(): Promise<void>;
  arm(): void;
  beginSubmissionAttempt(): Promise<void>;
  interrupt(reason?: PublishInterruptionReason): Promise<void>;
  stopSilently(): Promise<void>;
}

export interface PublishObservationEvent {
  eventId: string;
  observationId: string;
  publicationId: string;
  accountId: string;
  platformId: string;
  sequence: number;
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

export class PublishObservationManager {
  private readonly observations = new Map<string, ManagedPublishObservation>();

  constructor(
    private readonly onEvent: (event: PublishObservationEvent) => Promise<void>,
  ) {}

  attach(input: {
    publicationId: string;
    accountId: string;
    platformId: string;
    monitor: PublishResultMonitor;
    onFinished?: () => void;
  }): ManagedPublishObservation {
    void this.stop(input.accountId);
    const id = randomUUID();
    let stopped = false;
    let armed = false;
    let completed = false;
    let finished = false;
    let sequence = 0;
    let persistenceTail = Promise.resolve();
    let submissionAttempt: Promise<void> | undefined;
    let hasSubmissionEvidence = false;
    let hosted: ManagedPublishObservation;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      input.onFinished?.();
    };
    const persist = (result: PublishResultEvent): Promise<void> => {
      const event: PublishObservationEvent = {
        eventId: randomUUID(),
        observationId: id,
        publicationId: input.publicationId,
        accountId: input.accountId,
        platformId: input.platformId,
        sequence: ++sequence,
        result,
      };
      persistenceTail = persistenceTail.then(() => this.onEvent(event));
      return persistenceTail;
    };
    let unsubscribe = (): void => undefined;
    const finalize = (): void => {
      unsubscribe();
      input.monitor.stop();
      if (this.observations.get(input.accountId) === hosted) {
        this.observations.delete(input.accountId);
      }
      finish();
    };
    unsubscribe = input.monitor.subscribe((result) => {
      if (
        result.kind === "submission_attempted" ||
        result.kind === "verification_required" ||
        result.kind === "verifying" ||
        result.kind === "published"
      ) {
        hasSubmissionEvidence = true;
      }
      const persisted = persist(result);
      if (
        result.kind === "published" ||
        result.kind === "failed" ||
        result.kind === "uncertain" ||
        result.kind === "cancelled"
      ) {
        completed = true;
        void persisted.then(finalize);
      }
    });
    hosted = {
      id,
      ready: () => input.monitor.ready(),
      arm: () => {
        input.monitor.arm();
        armed = true;
      },
      beginSubmissionAttempt: async () => {
        hasSubmissionEvidence = true;
        submissionAttempt ??= persist({
          kind: "submission_attempted",
          source: "application_commit",
          message: "应用即将执行平台提交操作",
        }).then(() => input.monitor.submissionAttempted());
        await submissionAttempt;
      },
      interrupt: async (reason = "observation_interrupted") => {
        if (stopped) return;
        stopped = true;
        if (!completed && armed) {
          await input.monitor.interrupt(reason);
        }
        await persistenceTail;
        if (!completed) finalize();
      },
      stopSilently: async () => {
        if (hasSubmissionEvidence) {
          await hosted.interrupt();
          return;
        }
        if (stopped) return;
        stopped = true;
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

  async stop(accountId: string): Promise<void> {
    await this.observations.get(accountId)?.interrupt();
  }

  async stopAll(): Promise<void> {
    await Promise.all(
      [...this.observations.values()].map((observation) =>
        observation.interrupt("desktop_shutdown"),
      ),
    );
  }
}
