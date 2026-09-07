import { randomUUID } from "node:crypto";

import type { StartPublicationInput } from "@nedia-matrix/application-publishing";
import type { PublishContentForm } from "@nedia-matrix/ipc-contracts";

const MEDIA_SELECTION_TTL_MS = 30 * 60_000;

export interface MediaSelection {
  readonly accountId: string;
  readonly contentForm: PublishContentForm;
  readonly filePaths: readonly string[];
  readonly files: StartPublicationInput["assets"];
  readonly createdAt: number;
}

interface StoredMediaSelection extends MediaSelection {
  inUse: boolean;
}

export class MediaSelectionUnavailableError extends TypeError {
  constructor() {
    super("Media selection is missing, expired, or in use");
    this.name = "MediaSelectionUnavailableError";
  }
}

export class MediaSelectionStore {
  private readonly selections = new Map<string, StoredMediaSelection>();

  create(input: {
    accountId: string;
    contentForm: PublishContentForm;
    filePaths: readonly string[];
    files: StartPublicationInput["assets"];
  }): string {
    this.prune();
    const id = randomUUID();
    this.selections.set(id, {
      ...input,
      createdAt: Date.now(),
      inUse: false,
    });
    return id;
  }

  acquire(
    id: string,
    accountId: string,
    contentForm: PublishContentForm,
  ): MediaSelection {
    this.prune();
    const selection = this.selections.get(id);
    if (
      !selection ||
      selection.inUse ||
      selection.accountId !== accountId ||
      selection.contentForm !== contentForm
    ) {
      throw new MediaSelectionUnavailableError();
    }
    selection.inUse = true;
    return {
      accountId: selection.accountId,
      contentForm: selection.contentForm,
      filePaths: selection.filePaths,
      files: selection.files,
      createdAt: selection.createdAt,
    };
  }

  release(id: string): void {
    const selection = this.selections.get(id);
    if (selection) selection.inUse = false;
  }

  consume(id: string): void {
    this.selections.delete(id);
  }

  removeForAccount(accountId: string): void {
    for (const [id, selection] of this.selections) {
      if (selection.accountId === accountId) this.selections.delete(id);
    }
  }

  clear(): void {
    this.selections.clear();
  }

  private prune(): void {
    const expiredBefore = Date.now() - MEDIA_SELECTION_TTL_MS;
    for (const [id, selection] of this.selections) {
      if (!selection.inUse && selection.createdAt < expiredBefore) {
        this.selections.delete(id);
      }
    }
  }
}
