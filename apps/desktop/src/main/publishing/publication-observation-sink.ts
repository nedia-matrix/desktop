import type { PublishObservationEvent } from "./publish-observation-host.js";

interface ObservationPersistence {
  recordObservation(
    publicationId: string,
    result: PublishObservationEvent["result"],
  ): unknown;
}

export class PublicationObservationSink {
  private readonly pending = new Map<string, PublishObservationEvent>();

  constructor(
    private readonly persistence: ObservationPersistence,
    private readonly onPersisted: (event: PublishObservationEvent) => void,
    private readonly onDeferred: (event: PublishObservationEvent) => void,
    private readonly onError: (error: unknown) => void,
  ) {}

  get pendingCount(): number {
    return this.pending.size;
  }

  accept(event: PublishObservationEvent): void {
    try {
      this.persistence.recordObservation(event.publicationId, event.result);
    } catch (error) {
      const firstFailure = !this.pending.has(event.publicationId);
      this.pending.set(event.publicationId, event);
      this.onError(error);
      if (firstFailure) this.onDeferred(event);
      return;
    }

    this.pending.delete(event.publicationId);
    this.onPersisted(event);
  }

  retryPending(): void {
    for (const event of [...this.pending.values()]) this.accept(event);
  }
}
