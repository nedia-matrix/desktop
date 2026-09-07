import type { PlatformAccountSummary } from "@nedia-matrix/ipc-contracts";
import { describe, expect, it, vi } from "vitest";

import {
  cleanupClosedBrowserSession,
  removeAccountAndResources,
} from "../src/main/accounts/application/account-resource-cleanup.js";
import {
  shutdownDesktopRuntime,
  waitForShutdown,
} from "../src/main/bootstrap/runtime-cleanup.js";

const account = {
  id: "account-1",
  platformId: "douyin",
  profileId: "matrix-douyin-account-1",
} as PlatformAccountSummary;

describe("desktop runtime cleanup", () => {
  it("stops observations and releases media when a BrowserContext closes", () => {
    const publishObservations = { stop: vi.fn() };
    const mediaSelections = { removeForAccount: vi.fn() };

    cleanupClosedBrowserSession(account.id, {
      publishObservations,
      mediaSelections,
    });

    expect(publishObservations.stop).toHaveBeenCalledWith(account.id);
    expect(mediaSelections.removeForAccount).toHaveBeenCalledWith(account.id);
  });

  it("closes the session, deletes its profile, and removes local account resources", async () => {
    const publishObservations = { stop: vi.fn() };
    const mediaSelections = { removeForAccount: vi.fn() };
    const browserSessions = { remove: vi.fn(async () => undefined) };
    const accountStore = { remove: vi.fn() };

    await removeAccountAndResources(account, {
      accountStore,
      browserSessions,
      mediaSelections,
      publishObservations,
    });

    expect(publishObservations.stop).toHaveBeenCalledWith(account.id);
    expect(mediaSelections.removeForAccount).toHaveBeenCalledWith(account.id);
    expect(browserSessions.remove).toHaveBeenCalledWith(account);
    expect(accountStore.remove).toHaveBeenCalledWith(account.id);
    expect(browserSessions.remove.mock.invocationCallOrder[0]).toBeLessThan(
      accountStore.remove.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("stops all observations, clears media tokens, and closes every session on exit", async () => {
    const publishObservations = { stopAll: vi.fn() };
    const mediaSelections = { clear: vi.fn() };
    const browserSessions = { closeAll: vi.fn(async () => undefined) };

    await shutdownDesktopRuntime({
      browserSessions,
      mediaSelections,
      publishObservations,
    });

    expect(publishObservations.stopAll).toHaveBeenCalledOnce();
    expect(mediaSelections.clear).toHaveBeenCalledOnce();
    expect(browserSessions.closeAll).toHaveBeenCalledOnce();
  });

  it("reports a completed shutdown without leaving a timeout behind", async () => {
    vi.useFakeTimers();
    try {
      await expect(waitForShutdown(Promise.resolve(), 5_000)).resolves.toBe(
        "completed",
      );
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops waiting when shutdown exceeds its deadline", async () => {
    vi.useFakeTimers();
    try {
      const waiting = waitForShutdown(new Promise<void>(() => {}), 5_000);
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(waiting).resolves.toBe("timed-out");
    } finally {
      vi.useRealTimers();
    }
  });
});
