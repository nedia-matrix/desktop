import { beforeEach, describe, expect, it, vi } from "vitest";
const windows = vi.hoisted(() => [] as any[]);
vi.mock("electron", () => ({
  BrowserWindow: class {
    handlers: Record<string, Function> = {};
    webContents = {
      setWindowOpenHandler: vi.fn(),
      on: (name: string, callback: Function) => {
        this.handlers[name] = callback;
      },
    };
    loadURL = vi.fn().mockResolvedValue(undefined);
    show = vi.fn();
    close = vi.fn(() => this.handlers.closed?.());
    isDestroyed = () => false;
    on = (name: string, callback: Function) => {
      this.handlers[name] = callback;
    };
    constructor(readonly options: unknown) {
      windows.push(this);
    }
  },
}));
import { ElectronAutomationNotices } from "../src/main/shell/notifications/electron-automation-notices.js";
beforeEach(() => {
  windows.length = 0;
});
describe("automation notice windows", () => {
  it("shows manual publishing instructions without a close-browser action", async () => {
    const close = vi.fn();
    const sink = new ElectronAutomationNotices(close);
    sink.show({
      kind: "publish.awaiting_confirmation",
      accountId: "a",
      publicationId: "p",
    });
    await vi.waitFor(() => expect(windows[0].show).toHaveBeenCalledOnce());
    const html = decodeURIComponent(windows[0].loadURL.mock.calls[0][0]);
    expect(html).toContain("必须亲自点击");
    expect(html).not.toContain('href="https://notice.invalid/close"');
    windows[0].handlers["will-navigate"](
      { preventDefault: vi.fn() },
      "https://notice.invalid/close",
    );
    expect(close).not.toHaveBeenCalled();
  });
  it.each(["close", "dismiss"])(
    "handles %s without blocking the caller",
    async (action) => {
      const close = vi.fn().mockResolvedValue(undefined);
      new ElectronAutomationNotices(close).show({
        kind: "account.synced",
        accountId: "a",
      });
      await vi.waitFor(() => expect(windows[0].show).toHaveBeenCalledOnce());
      windows[0].handlers["will-navigate"](
        { preventDefault: vi.fn() },
        `https://notice.invalid/${action}`,
      );
      await vi.waitFor(() => expect(windows[0].close).toHaveBeenCalledOnce());
      expect(close).toHaveBeenCalledTimes(action === "close" ? 1 : 0);
    },
  );
  it("replaces the old sync prompt when publishing becomes ready", () => {
    const sink = new ElectronAutomationNotices(vi.fn());
    sink.show({ kind: "account.synced", accountId: "a" });
    sink.show({
      kind: "publish.awaiting_confirmation",
      accountId: "a",
      publicationId: "p",
    });
    expect(windows[0].close).toHaveBeenCalledOnce();
    expect(windows).toHaveLength(2);
  });
});
