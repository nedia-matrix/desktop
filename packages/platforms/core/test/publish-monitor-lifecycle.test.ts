import { describe, expect, it } from "vitest";

import { PublishMonitorLifecycle } from "../src/runtime.js";

describe("PublishResultMonitor lifecycle contract", () => {
  it("follows observing_draft -> armed -> verifying -> completed", () => {
    const lifecycle = new PublishMonitorLifecycle();
    expect(lifecycle.state).toBe("observing_draft");
    expect(lifecycle.beginVerification()).toBe(false);
    expect(lifecycle.arm()).toBe(true);
    expect(lifecycle.beginVerification()).toBe(true);
    expect(lifecycle.complete()).toBe(true);
    expect(lifecycle.state).toBe("completed");
  });

  it("returns to armed after platform verification is required", () => {
    const lifecycle = new PublishMonitorLifecycle();
    lifecycle.arm();
    lifecycle.beginVerification();
    expect(lifecycle.requireVerification()).toBe(true);
    expect(lifecycle.state).toBe("armed");
    expect(lifecycle.beginVerification()).toBe(true);
  });

  it("makes arm and completion idempotent", () => {
    const lifecycle = new PublishMonitorLifecycle();
    expect(lifecycle.arm()).toBe(true);
    expect(lifecycle.arm()).toBe(false);
    expect(lifecycle.complete()).toBe(true);
    expect(lifecycle.complete()).toBe(false);
    expect(lifecycle.requireVerification()).toBe(false);
  });
});
