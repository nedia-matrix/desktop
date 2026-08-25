import type {
  PlatformAccountSummary,
  PlatformSummary,
  PublicationSummary,
  PublishResultUpdate,
} from "@nedia-matrix/ipc-contracts";

export type StatusKind = "idle" | "busy" | "error";

export interface AppStatus {
  message: string;
  kind: StatusKind;
}

export class AppContext {
  platforms: readonly PlatformSummary[] = [];
  accounts: readonly PlatformAccountSummary[] = [];
  publications: readonly PublicationSummary[] = [];

  private readonly publishListeners = new Set<
    (update: PublishResultUpdate) => void
  >();
  private readonly recentPublishUpdates = new Map<
    string,
    PublishResultUpdate
  >();
  private readonly accountListeners = new Set<
    (accounts: readonly PlatformAccountSummary[]) => void
  >();
  private readonly statusListeners = new Set<(status: AppStatus) => void>();
  private accountRefreshRequested = false;
  private accountRefreshInFlight: Promise<void> | undefined;
  private status: AppStatus = { message: "准备就绪", kind: "idle" };

  constructor() {
    window.matrix.onPlatformAccountsChanged(() => {
      this.requestAccountRefresh();
    });
    window.matrix.onPublishResultUpdate((update) => {
      this.recentPublishUpdates.set(update.observationId, update);
      if (this.recentPublishUpdates.size > 20) {
        const oldestId = this.recentPublishUpdates.keys().next().value as
          string | undefined;
        if (oldestId) this.recentPublishUpdates.delete(oldestId);
      }
      for (const listener of this.publishListeners) listener(update);
      void this.refreshPublications();
    });
  }

  onAccountUpdate(
    listener: (accounts: readonly PlatformAccountSummary[]) => void,
  ): () => void {
    this.accountListeners.add(listener);
    return () => this.accountListeners.delete(listener);
  }

  async initialize(): Promise<void> {
    this.platforms = await window.matrix.listPlatforms();
  }

  async refreshAccounts(): Promise<readonly PlatformAccountSummary[]> {
    this.accounts = await window.matrix.listPlatformAccounts();
    return this.accounts;
  }

  private requestAccountRefresh(): void {
    this.accountRefreshRequested = true;
    if (this.accountRefreshInFlight) return;

    this.accountRefreshInFlight = (async () => {
      do {
        this.accountRefreshRequested = false;
        await this.refreshAccounts();
        for (const listener of this.accountListeners) listener(this.accounts);
      } while (this.accountRefreshRequested);
    })().finally(() => {
      this.accountRefreshInFlight = undefined;
    });
    void this.accountRefreshInFlight.catch(() => undefined);
  }

  async refreshPublications(): Promise<readonly PublicationSummary[]> {
    this.publications = await window.matrix.listPublications();
    return this.publications;
  }

  setStatus(message: string, kind: StatusKind = "idle"): void {
    this.status = { message, kind };
    for (const listener of this.statusListeners) listener(this.status);
  }

  currentStatus(): AppStatus {
    return this.status;
  }

  onStatusUpdate(listener: (status: AppStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onPublishUpdate(listener: (update: PublishResultUpdate) => void): () => void {
    this.publishListeners.add(listener);
    return () => this.publishListeners.delete(listener);
  }

  recentPublishUpdate(observationId: string): PublishResultUpdate | undefined {
    return this.recentPublishUpdates.get(observationId);
  }
}
