import type {
  PlatformAccountSummary,
  PlatformSummary,
  PublicationSummary,
  PublishResultUpdate,
} from "@nedia-matrix/ipc-contracts";

export type StatusKind = "idle" | "busy" | "error";

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

  constructor(private readonly statusOutput: HTMLOutputElement) {
    window.matrix.onPlatformAccountUpdate((account) => {
      const index = this.accounts.findIndex(({ id }) => id === account.id);
      this.accounts =
        index === -1
          ? [...this.accounts, account]
          : this.accounts.map((current) =>
              current.id === account.id ? account : current,
            );
      for (const listener of this.accountListeners) listener(this.accounts);
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

  async refreshPublications(): Promise<readonly PublicationSummary[]> {
    this.publications = await window.matrix.listPublications();
    return this.publications;
  }

  setStatus(message: string, kind: StatusKind = "idle"): void {
    this.statusOutput.textContent = message;
    this.statusOutput.dataset.kind = kind;
  }

  onPublishUpdate(listener: (update: PublishResultUpdate) => void): () => void {
    this.publishListeners.add(listener);
    return () => this.publishListeners.delete(listener);
  }

  recentPublishUpdate(observationId: string): PublishResultUpdate | undefined {
    return this.recentPublishUpdates.get(observationId);
  }
}
