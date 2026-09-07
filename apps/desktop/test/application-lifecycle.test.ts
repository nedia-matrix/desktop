import { describe, expect, it } from "vitest";

import { ApplicationLifecycle } from "../src/main/bootstrap/application-lifecycle.js";

describe("application lifecycle", () => {
  it("opens windows immediately while the application is running", () => {
    const lifecycle = new ApplicationLifecycle();

    expect(lifecycle.requestWindowOpen()).toBe("open-now");
  });

  it("ignores window requests while shutdown is in progress", () => {
    const lifecycle = new ApplicationLifecycle();

    expect(lifecycle.beginShutdown()).toBe(true);
    expect(lifecycle.requestWindowOpen()).toBe("ignore-during-shutdown");
    expect(lifecycle.requestWindowOpen()).toBe("ignore-during-shutdown");
  });

  it("starts shutdown only once", () => {
    const lifecycle = new ApplicationLifecycle();

    expect(lifecycle.beginShutdown()).toBe(true);
    expect(lifecycle.beginShutdown()).toBe(false);
  });
});
