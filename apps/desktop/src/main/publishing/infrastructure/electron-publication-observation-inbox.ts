import Store from "electron-store";

import type { PublishObservationEvent } from "../observations/publish-observation-manager.js";

type ObservationInboxSchema = {
  events?: unknown;
};

export interface PublicationObservationInbox {
  list(): PublishObservationEvent[];
  append(event: PublishObservationEvent): void;
  remove(eventId: string): void;
}

function isObservationEvent(value: unknown): value is PublishObservationEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const event = value as Partial<PublishObservationEvent>;
  return (
    typeof event.eventId === "string" &&
    typeof event.observationId === "string" &&
    typeof event.publicationId === "string" &&
    typeof event.accountId === "string" &&
    typeof event.platformId === "string" &&
    typeof event.sequence === "number" &&
    typeof event.result === "object" &&
    event.result !== null
  );
}

export class ElectronPublicationObservationInbox implements PublicationObservationInbox {
  private readonly store = new Store<ObservationInboxSchema>({
    name: "matrix-publication-observation-inbox",
  });

  list(): PublishObservationEvent[] {
    const stored = this.store.get("events");
    if (!Array.isArray(stored)) return [];
    return stored.filter(isObservationEvent).sort((left, right) => {
      const publication = left.publicationId.localeCompare(right.publicationId);
      return publication === 0 ? left.sequence - right.sequence : publication;
    });
  }

  append(event: PublishObservationEvent): void {
    const events = this.list();
    if (events.some(({ eventId }) => eventId === event.eventId)) return;
    this.store.set("events", [...events, event]);
  }

  remove(eventId: string): void {
    this.store.set(
      "events",
      this.list().filter((event) => event.eventId !== eventId),
    );
  }
}
