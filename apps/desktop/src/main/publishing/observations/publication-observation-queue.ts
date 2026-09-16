import type { PublishObservationEvent } from "@nedia-matrix/publishing";
import { isDeepStrictEqual } from "node:util";
import type { PublicationObservationInbox } from "./publication-observation-inbox.js";

interface ObservationPersistence {
  recordObservation(
    publicationId: string,
    result: PublishObservationEvent["result"],
    sequence: number,
    expectedIdentity: { accountId: string; platformId: string },
  ): unknown;
}

interface PendingObservation {
  event: PublishObservationEvent;
  inboxStored: boolean;
  resolve: () => void;
}

export class PublicationObservationQueue {
  private readonly pending = new Map<string, PendingObservation>();
  private retrying = false;

  constructor(
    private readonly persistence: ObservationPersistence,
    private readonly inbox: PublicationObservationInbox,
    private readonly onPersisted: (event: PublishObservationEvent) => void,
    private readonly onDeferred: (event: PublishObservationEvent) => void,
    private readonly onError: (error: unknown) => void,
    private readonly commit: (operation: () => void) => void = (operation) =>
      operation(),
  ) {}

  get pendingCount(): number {
    return this.pending.size;
  }

  accept(event: PublishObservationEvent): Promise<void> {
    const existing = this.pending.get(event.eventId);
    if (existing) {
      if (!isDeepStrictEqual(existing.event, event))
        return Promise.reject(
          new Error("Conflicting pending observation event ID"),
        );
      return new Promise((resolve) => {
        const previous = existing.resolve;
        existing.resolve = () => {
          previous();
          resolve();
        };
      });
    }
    return new Promise<void>((resolve) => {
      try {
        this.inbox.append(event);
      } catch (error) {
        this.onError(error);
        this.pending.set(event.eventId, {
          event,
          inboxStored: false,
          resolve,
        });
        this.onDeferred(event);
        return;
      }
      if (this.project(event)) {
        resolve();
        return;
      }
      const firstFailure = !this.pending.has(event.eventId);
      this.pending.set(event.eventId, { event, inboxStored: true, resolve });
      if (firstFailure) this.onDeferred(event);
    });
  }

  replayPersisted(): void {
    for (const event of this.inbox.list()) {
      this.apply(event);
      this.onPersisted(event);
    }
  }

  private project(event: PublishObservationEvent): boolean {
    try {
      this.apply(event);
    } catch (error) {
      this.onError(error);
      return false;
    }
    this.onPersisted(event);
    return true;
  }

  private apply(event: PublishObservationEvent): void {
    this.commit(() => {
      this.persistence.recordObservation(
        event.publicationId,
        event.result,
        event.sequence,
        { accountId: event.accountId, platformId: event.platformId },
      );
      // A failed acknowledgement must retry the same sequence: the projection
      // may already be durable, and recordObservation is sequence-idempotent.
      this.inbox.remove(event.eventId);
    });
  }

  retryPending(): void {
    if (this.retrying) return;
    this.retrying = true;
    try {
      for (const [eventId, pending] of [...this.pending.entries()]) {
        if (!pending.inboxStored) {
          try {
            this.inbox.append(pending.event);
            pending.inboxStored = true;
          } catch (error) {
            this.onError(error);
            break;
          }
        }
        if (!this.project(pending.event)) break;
        this.pending.delete(eventId);
        pending.resolve();
      }
    } finally {
      this.retrying = false;
    }
  }
}
