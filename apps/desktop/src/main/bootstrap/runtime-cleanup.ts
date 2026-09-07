interface RuntimeShutdownDependencies {
  publishObservations: {
    stopAll(): Promise<void>;
  };
  mediaSelections: {
    clear(): void;
  };
  browserSessions: {
    closeAll(): Promise<void>;
  };
}

export type ShutdownWaitResult = "completed" | "timed-out";

export async function shutdownDesktopRuntime(
  dependencies: RuntimeShutdownDependencies,
): Promise<void> {
  await dependencies.publishObservations.stopAll();
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
