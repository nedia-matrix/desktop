import { afterEach, describe, expect, it, vi } from "vitest";

// Run the hook with dependency changes and effect cleanup, without an Electron DOM.
const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  cursor: 0,
  deps: undefined as unknown[] | undefined,
  cleanup: undefined as (() => void) | undefined,
}));
vi.mock("preact/hooks", () => ({
  useState(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.states)) hooks.states[index] = initial;
    return [
      hooks.states[index],
      (value: unknown) => {
        hooks.states[index] = value;
      },
    ];
  },
  useEffect(effect: () => (() => void) | undefined, deps: unknown[]) {
    if (hooks.deps?.every((value, index) => Object.is(value, deps[index])))
      return;
    hooks.cleanup?.();
    hooks.deps = deps;
    hooks.cleanup = effect();
  },
}));

import { useDiagnosticTimeline } from "../src/renderer/src/hooks/use-diagnostic-timeline.js";

function render(traceId: string | undefined, expanded = true) {
  hooks.cursor = 0;
  return useDiagnosticTimeline(traceId, expanded);
}
function deferred() {
  let resolve!: (records: unknown[]) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<unknown[]>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  hooks.cleanup?.();
  hooks.states = [];
  hooks.deps = undefined;
  hooks.cleanup = undefined;
  vi.unstubAllGlobals();
});

describe("diagnostic timeline loading", () => {
  it("loads after trace lookup and keeps the read alive through rerenders", async () => {
    const read = deferred();
    const readDiagnosticTrace = vi.fn(() => read.promise);
    vi.stubGlobal("window", { matrix: { readDiagnosticTrace } });
    render(undefined);
    expect(readDiagnosticTrace).not.toHaveBeenCalled();
    render("trace-1");
    render("trace-1");
    const records = [{ traceId: "trace-1", sequence: 1 }];
    read.resolve(records);
    await read.promise;
    expect(render("trace-1").records).toEqual(records);
    expect(readDiagnosticTrace).toHaveBeenCalledOnce();
  });

  it("ignores a cancelled read and reloads when reopened", async () => {
    const first = deferred();
    const second = deferred();
    const readDiagnosticTrace = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    vi.stubGlobal("window", { matrix: { readDiagnosticTrace } });
    render("trace-1");
    render("trace-1", false);
    first.resolve([{ sequence: 1 }]);
    await first.promise;
    expect(render("trace-1", false).records).toBeNull();
    render("trace-1");
    second.resolve([{ sequence: 2 }]);
    await second.promise;
    expect(render("trace-1").records).toEqual([{ sequence: 2 }]);
  });

  it("shows a read failure and retries when reopened", async () => {
    const read = deferred();
    const readDiagnosticTrace = vi.fn(() => read.promise);
    vi.stubGlobal("window", { matrix: { readDiagnosticTrace } });
    render("trace-1");
    read.reject(new Error("日志读取失败"));
    await read.promise.catch(() => {});
    expect(render("trace-1").error).toBe("日志读取失败");
    render("trace-1", false);
    render("trace-1");
    expect(readDiagnosticTrace).toHaveBeenCalledTimes(2);
  });
});
