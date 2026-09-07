import type { PlatformAccountSummary } from "@nedia-matrix/ipc-contracts";

interface AccountCleanupDependencies {
  publishObservations: {
    stop(accountId: string): Promise<void>;
  };
  mediaSelections: {
    removeForAccount(accountId: string): void;
  };
}

interface AccountRemovalDependencies extends AccountCleanupDependencies {
  browserSessions: {
    remove(account: PlatformAccountSummary): Promise<void>;
  };
  beforeAccountRemove?: (() => void | Promise<void>) | undefined;
  accountStore: {
    remove(accountId: string): void;
  };
}

export function cleanupClosedBrowserSession(
  accountId: string,
  dependencies: AccountCleanupDependencies,
): void {
  void dependencies.publishObservations.stop(accountId);
  dependencies.mediaSelections.removeForAccount(accountId);
}

export async function removeAccountAndResources(
  account: PlatformAccountSummary,
  dependencies: AccountRemovalDependencies,
): Promise<void> {
  await dependencies.publishObservations.stop(account.id);
  dependencies.mediaSelections.removeForAccount(account.id);
  await dependencies.browserSessions.remove(account);
  await dependencies.beforeAccountRemove?.();
  dependencies.accountStore.remove(account.id);
}
