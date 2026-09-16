import type { PublishResultEvent } from "@nedia-matrix/platform-sdk";

import type { PublishResultUpdate } from "./index.js";

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
