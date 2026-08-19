import type { PlatformAccountSummary } from "@nedia-matrix/ipc-contracts";

interface AccountCleanupDependencies {
  publishObservations: {
    stop(accountId: string): void;
  };
  mediaSelections: {
    removeForAccount(accountId: string): void;
  };
}

interface AccountRemovalDependencies extends AccountCleanupDependencies {
  browserSessions: {
    remove(account: PlatformAccountSummary): Promise<void>;
  };
  accountStore: {
    remove(accountId: string): void;
  };
}

interface RuntimeShutdownDependencies {
  publishObservations: {
    stopAll(): void;
  };
  mediaSelections: {
    clear(): void;
  };
  browserSessions: {
    closeAll(): Promise<void>;
  };
}

export type ShutdownWaitResult = "completed" | "timed-out";

export function cleanupClosedBrowserSession(
  accountId: string,
  dependencies: AccountCleanupDependencies,
): void {
  dependencies.publishObservations.stop(accountId);
  dependencies.mediaSelections.removeForAccount(accountId);
}

export async function removeAccountAndResources(
  account: PlatformAccountSummary,
  dependencies: AccountRemovalDependencies,
): Promise<void> {
  dependencies.publishObservations.stop(account.id);
  dependencies.mediaSelections.removeForAccount(account.id);
  await dependencies.browserSessions.remove(account);
  dependencies.accountStore.remove(account.id);
}

export async function shutdownDesktopRuntime(
  dependencies: RuntimeShutdownDependencies,
): Promise<void> {
  dependencies.publishObservations.stopAll();
  dependencies.mediaSelections.clear();
  await dependencies.browserSessions.closeAll();
}

export async function waitForShutdown(
  shutdown: Promise<void>,
  timeoutMs: number,
): Promise<ShutdownWaitResult> {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new TypeError("Shutdown timeout must be non-negative");
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<ShutdownWaitResult>((resolve) => {
    timeout = setTimeout(() => resolve("timed-out"), timeoutMs);
  });

  try {
    return await Promise.race([
      shutdown.then((): ShutdownWaitResult => "completed"),
      timedOut,
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
