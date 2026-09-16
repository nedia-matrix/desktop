import { expect, it } from "vitest";
import { ApplicationCommandGate } from "../src/main/application/application-command-gate.js";

it("blocks new commands and drains in-flight work before shutdown", async () => {
  const gate = new ApplicationCommandGate();
  let finish!: () => void;
  const commands = gate.guard({
    prepare: () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    list: () => [],
  });
  const work = commands.prepare();
  let stopped = false;
  const stopping = gate.stop().then(() => {
    stopped = true;
  });
  expect(() => commands.list()).toThrow("shutting down");
  await Promise.resolve();
  expect(stopped).toBe(false);
  finish();
  await work;
  await stopping;
  expect(stopped).toBe(true);
});
