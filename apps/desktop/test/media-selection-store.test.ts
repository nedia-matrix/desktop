import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MediaSelectionStore,
  MediaSelectionUnavailableError,
} from "../src/main/publishing/infrastructure/media-selection-store.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("MediaSelectionStore", () => {
  it("only returns matching, unused selections", () => {
    const store = new MediaSelectionStore();
    const id = store.create({
      accountId: "account-1",
      contentForm: "video",
      filePaths: ["/tmp/video.mp4"],
      files: [{ name: "video.mp4", size: 1 }],
    });

    const selection = store.acquire(id, "account-1", "video");

    expect(selection).not.toHaveProperty("inUse");

    expect(() => store.acquire(id, "account-1", "video")).toThrow(
      MediaSelectionUnavailableError,
    );

    store.release(id);
    expect(store.acquire(id, "account-1", "video")).toEqual(selection);
  });

  it("consumes selections and removes every selection for an account", () => {
    const store = new MediaSelectionStore();
    const consumed = store.create({
      accountId: "account-1",
      contentForm: "video",
      filePaths: ["/tmp/first.mp4"],
      files: [{ name: "first.mp4", size: 1 }],
    });
    const removed = store.create({
      accountId: "account-1",
      contentForm: "imageText",
      filePaths: ["/tmp/image.png"],
      files: [{ name: "image.png", size: 1 }],
    });
    store.consume(consumed);
    store.removeForAccount("account-1");

    expect(() => store.acquire(consumed, "account-1", "video")).toThrow();
    expect(() => store.acquire(removed, "account-1", "imageText")).toThrow();
  });

  it("expires selections after thirty minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-07T00:00:00.000Z"));
    const store = new MediaSelectionStore();
    const id = store.create({
      accountId: "account-1",
      contentForm: "video",
      filePaths: ["/tmp/video.mp4"],
      files: [{ name: "video.mp4", size: 1 }],
    });
    vi.advanceTimersByTime(30 * 60_000 + 1);

    expect(() => store.acquire(id, "account-1", "video")).toThrow();
  });

  it("clears every pending selection during application shutdown", () => {
    const store = new MediaSelectionStore();
    const id = store.create({
      accountId: "account-1",
      contentForm: "video",
      filePaths: ["/tmp/video.mp4"],
      files: [{ name: "video.mp4", size: 1 }],
    });

    store.clear();

    expect(() => store.acquire(id, "account-1", "video")).toThrow();
  });
});
