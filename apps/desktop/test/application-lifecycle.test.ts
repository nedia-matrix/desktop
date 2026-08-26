import { describe, expect, it } from "vitest";

import { ApplicationLifecycle } from "../src/main/application-lifecycle.js";

describe("application lifecycle", () => {
  it("opens windows immediately while the application is running", () => {
    const lifecycle = new ApplicationLifecycle();

    expect(lifecycle.requestWindowOpen()).toBe("open-now");
    expect(lifecycle.shouldRelaunchAfterShutdown()).toBe(false);
  });

  it("requests one relaunch when a window is opened during shutdown", () => {
    const lifecycle = new ApplicationLifecycle();

    expect(lifecycle.beginShutdown()).toBe(true);
    expect(lifecycle.requestWindowOpen()).toBe("relaunch-after-shutdown");
    expect(lifecycle.requestWindowOpen()).toBe("relaunch-after-shutdown");
    expect(lifecycle.shouldRelaunchAfterShutdown()).toBe(true);
  });

  it("starts shutdown only once", () => {
    const lifecycle = new ApplicationLifecycle();

    expect(lifecycle.beginShutdown()).toBe(true);
    expect(lifecycle.beginShutdown()).toBe(false);
  });
});
