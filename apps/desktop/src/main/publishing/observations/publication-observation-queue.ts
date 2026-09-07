import type { PublishObservationEvent } from "./publish-observation-manager.js";
import type { PublicationObservationInbox } from "../infrastructure/electron-publication-observation-inbox.js";

interface ObservationPersistence {
  recordObservation(
    publicationId: string,
    result: PublishObservationEvent["result"],
    sequence: number,
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
  ) {}

  get pendingCount(): number {
    return this.pending.size;
  }

  accept(event: PublishObservationEvent): Promise<void> {
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
      this.persistence.recordObservation(
        event.publicationId,
        event.result,
        event.sequence,
      );
      this.inbox.remove(event.eventId);
      this.onPersisted(event);
    }
  }

  private project(event: PublishObservationEvent): boolean {
    try {
      this.persistence.recordObservation(
        event.publicationId,
        event.result,
        event.sequence,
      );
    } catch (error) {
      this.onError(error);
      return false;
    }

    this.inbox.remove(event.eventId);
    this.onPersisted(event);
    return true;
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
