interface AccountCleanupDependencies {
  publishObservations: {
    stop(accountId: string): Promise<void>;
  };
  mediaSelections: {
    removeForAccount(accountId: string): void;
  };
}

export function cleanupClosedBrowserSession(
  accountId: string,
  dependencies: AccountCleanupDependencies,
): void {
  void dependencies.publishObservations.stop(accountId);
  dependencies.mediaSelections.removeForAccount(accountId);
}
