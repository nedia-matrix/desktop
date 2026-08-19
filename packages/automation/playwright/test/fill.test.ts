import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Locator, Page } from "playwright";
import { describe, expect, it, vi } from "vitest";

import { PlaywrightAutomationDriver } from "../src/index.js";

function contentEditablePage() {
  const fill = vi.fn(async () => undefined);
  const range = {
    selectNodeContents: vi.fn(),
    collapse: vi.fn(),
  };
  const selection = {
    removeAllRanges: vi.fn(),
    addRange: vi.fn(),
  };
  const ownerDocument = {
    activeElement: null as unknown,
    getSelection: () => selection,
    createRange: () => range,
  };
  const element = {
    ownerDocument,
    innerText: "喵～",
    textContent: "喵～#添加话题 @好友",
    getAttribute: (name: string) =>
      name === "contenteditable" ? "true" : null,
  };
  const blur = vi.fn(async () => {
    ownerDocument.activeElement = null;
  });
  const focus = vi.fn(async () => {
    ownerDocument.activeElement = element;
  });
  const press = vi.fn(async () => undefined);
  const pressSequentially = vi.fn(async () => undefined);
  const dispatchEvent = vi.fn(async () => undefined);
  const locator = {
    count: async () => 1,
    nth: () => locator,
    isVisible: async () => true,
    isEnabled: async () => true,
    isEditable: async () => true,
    evaluate: async (callback: (target: typeof element) => unknown) =>
      callback(element),
    fill,
    blur,
    focus,
    press,
    pressSequentially,
    dispatchEvent,
    textContent: async () => "喵～#添加话题 @好友",
  } as unknown as Locator;
  const page = {
    getByTestId: () => locator,
    evaluateHandle: vi.fn(async () => ({
      dispose: vi.fn(async () => undefined),
    })),
  } as unknown as Page;
  return {
    page,
    fill,
    blur,
    focus,
    press,
    pressSequentially,
    dispatchEvent,
    range,
    selection,
  };
}

describe("Playwright form filling", () => {
  it("validates a contenteditable using visible editor text", async () => {
    vi.useFakeTimers();
    try {
      const { page, fill, blur } = contentEditablePage();
      const driver = new PlaywrightAutomationDriver(
        page,
        { allowedHostSuffixes: ["example.test"] } as never,
        "/tmp/evidence",
      );
      const target = (
        await driver.query({ kind: "test-id", value: "body" })
      )[0];
      expect(target).toBeDefined();

      const filling = driver.fill(target!, "喵～");
      await vi.advanceTimersByTimeAsync(550);
      await filling;

      expect(fill).toHaveBeenCalledWith("喵～");
      expect(blur).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops local image files through a browser DataTransfer", async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "matrix-drop-"));
    try {
      const imagePath = join(temporaryDirectory, "image.png");
      await writeFile(imagePath, Buffer.from([1, 2, 3]));
      const { page, dispatchEvent } = contentEditablePage();
      const driver = new PlaywrightAutomationDriver(
        page,
        { allowedHostSuffixes: ["example.test"] } as never,
        "/tmp/evidence",
      );
      const target = (
        await driver.query({ kind: "test-id", value: "drop" })
      )[0];
      expect(target).toBeDefined();

      await driver.dropFiles(target!, [imagePath]);

      expect(dispatchEvent).toHaveBeenNthCalledWith(
        1,
        "dragover",
        expect.objectContaining({ dataTransfer: expect.anything() }),
      );
      expect(dispatchEvent).toHaveBeenNthCalledWith(
        2,
        "drop",
        expect.objectContaining({ dataTransfer: expect.anything() }),
      );
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("types and commits a native topic through keyboard events", async () => {
    const { page, focus, press, pressSequentially, range, selection } =
      contentEditablePage();
    const driver = new PlaywrightAutomationDriver(
      page,
      { allowedHostSuffixes: ["example.test"] } as never,
      "/tmp/evidence",
    );
    const target = (await driver.query({ kind: "test-id", value: "body" }))[0];
    expect(target).toBeDefined();

    await driver.typeText(target!, "#旅行", 80);
    await driver.pressKey(target!, "Enter");

    expect(focus).toHaveBeenCalledOnce();
    expect(range.collapse).toHaveBeenCalledWith(false);
    expect(selection.addRange).toHaveBeenCalledWith(range);
    expect(pressSequentially).toHaveBeenCalledWith("#旅行", { delay: 80 });
    expect(press).toHaveBeenCalledWith("Enter");
  });
});
