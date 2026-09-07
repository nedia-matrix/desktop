import { describe, expect, it } from "vitest";

import { RuntimeEventBuffer } from "../src/main/runtime-api/events/runtime-event-buffer.js";

describe("RuntimeEventBuffer", () => {
  it("resumes after a cursor and reports when older events were evicted", async () => {
    const events = new RuntimeEventBuffer<string>(2);
    events.append("one");
    events.append("two");
    events.append("three");

    await expect(events.poll(1, 0)).resolves.toEqual({
      cursor: 3,
      events: ["two", "three"],
      reset: false,
    });
    await expect(events.poll(0, 0)).resolves.toEqual({
      cursor: 3,
      events: ["two", "three"],
      reset: true,
    });
  });

  it("releases a pending poll when a new event arrives", async () => {
    const events = new RuntimeEventBuffer<string>();
    const pending = events.poll(0, 1_000);

    events.append("published");

    await expect(pending).resolves.toEqual({
      cursor: 1,
      events: ["published"],
      reset: false,
    });
  });

  it("resets an ahead cursor immediately after a runtime restart", async () => {
    const events = new RuntimeEventBuffer<string>();

    await expect(events.poll(9, 1_000)).resolves.toEqual({
      cursor: 0,
      events: [],
      reset: true,
    });
  });

  it("does not leave new polls waiting after the buffer closes", async () => {
    const events = new RuntimeEventBuffer<string>();

    events.close();

    await expect(events.poll(0, 20_000)).resolves.toEqual({
      cursor: 0,
      events: [],
      reset: false,
    });
  });

  it("accepts long polls again after reopening", async () => {
    const events = new RuntimeEventBuffer<string>();
    events.close();
    events.open();

    const pending = events.poll(0, 1_000);
    events.append("published");

    await expect(pending).resolves.toEqual({
      cursor: 1,
      events: ["published"],
      reset: false,
    });
  });
});
