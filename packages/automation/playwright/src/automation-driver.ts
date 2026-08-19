import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join } from "node:path";

import type {
  AutomationKey,
  AutomationDriver,
  ElementReference,
  EvidenceReference,
  LocatorCandidate,
} from "@nedia-matrix/automation-contracts";
import type { PlatformBrowserPolicy } from "@nedia-matrix/platform-core";
import type { Locator, Page } from "playwright";

import { isAllowedPlatformNavigation } from "./navigation-policy.js";

const MAX_ELEMENT_REFERENCES = 500;
const MAX_QUERY_MATCHES = 100;

type LocatorRoot = Page | Locator;

function locatorForCandidate(
  root: LocatorRoot,
  candidate: LocatorCandidate,
): Locator {
  switch (candidate.kind) {
    case "test-id":
      return root.getByTestId(candidate.value);
    case "css":
      return root.locator(candidate.selector);
    case "text":
      return root.getByText(candidate.text.value, {
        exact: candidate.text.exact,
      });
    case "label":
      return root.getByLabel(candidate.text.value, {
        exact: candidate.text.exact,
      });
    case "aria": {
      if (candidate.role) {
        const role = candidate.role as Parameters<Page["getByRole"]>[0];
        return root.getByRole(role, {
          ...(candidate.name === undefined
            ? {}
            : { name: candidate.name.value, exact: candidate.name.exact }),
        });
      }
      if (!candidate.name) return root.locator("[aria-label]");
      const operator = candidate.name.exact ? "=" : "*=";
      return root.locator(
        `[aria-label${operator}${JSON.stringify(candidate.name.value)}]`,
      );
    }
  }
}

async function readElementState(
  locator: Locator,
): Promise<ElementReference["state"]> {
  const [visible, enabled, editable] = await Promise.all([
    locator.isVisible().catch(() => false),
    locator.isEnabled().catch(() => false),
    locator.isEditable().catch(() => false),
  ]);
  return { attached: true, visible, enabled, editable };
}

async function focusAtTextEnd(locator: Locator): Promise<void> {
  const alreadyFocused = await locator.evaluate(
    (element) => element.ownerDocument.activeElement === element,
  );
  if (alreadyFocused) return;

  await locator.focus();
  await locator.evaluate((element) => {
    if (element.getAttribute("contenteditable") === "true") {
      const selection = element.ownerDocument.getSelection();
      const range = element.ownerDocument.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }

    const value = Reflect.get(element, "value");
    const setSelectionRange = Reflect.get(element, "setSelectionRange");
    if (typeof value === "string" && typeof setSelectionRange === "function") {
      Reflect.apply(setSelectionRange, element, [value.length, value.length]);
    }
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

function normalizeFilledText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function mediaType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function assertAbsoluteFilePaths(filePaths: readonly string[]): void {
  if (
    filePaths.length === 0 ||
    filePaths.some((filePath) => !isAbsolute(filePath))
  ) {
    throw new TypeError("Upload paths must be non-empty absolute paths");
  }
}

export class PlaywrightAutomationDriver implements AutomationDriver {
  private readonly locators = new Map<string, Locator>();

  constructor(
    private readonly page: Page,
    private readonly browser: PlatformBrowserPolicy,
    private readonly evidenceDirectory: string,
  ) {}

  async currentUrl(): Promise<string> {
    return this.page.url();
  }

  async navigate(url: string): Promise<void> {
    if (!isAllowedPlatformNavigation(url, this.browser)) {
      throw new Error("Navigation target is outside the platform boundary");
    }
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
  }

  async wait(milliseconds: number): Promise<void> {
    await delay(milliseconds);
  }

  async query(
    candidate: LocatorCandidate,
  ): Promise<readonly ElementReference[]> {
    const matches = locatorForCandidate(this.page, candidate);
    const count = Math.min(await matches.count(), MAX_QUERY_MATCHES);
    const references: ElementReference[] = [];

    for (let index = 0; index < count; index += 1) {
      const locator = matches.nth(index);
      const id = randomUUID();
      this.remember(id, locator);
      references.push({ id, state: await readElementState(locator) });
    }
    return references;
  }

  async click(target: ElementReference): Promise<void> {
    await this.locatorFor(target).click();
  }

  async fill(target: ElementReference, value: string): Promise<void> {
    const locator = this.locatorFor(target);
    const contentEditable = await locator.evaluate(
      (element) => element.getAttribute("contenteditable") === "true",
    );
    await locator.fill(value);
    await delay(contentEditable ? 500 : 50);
    await locator.blur();
    await delay(50);

    let actual: string | null;
    if (contentEditable) {
      actual = await locator.evaluate((element) => {
        const innerText = Reflect.get(element, "innerText");
        if (typeof innerText === "string") return innerText;
        return element.textContent;
      });
    } else {
      actual = await locator.inputValue().catch(() => null);
    }
    if (
      typeof actual !== "string" ||
      normalizeFilledText(actual) !== normalizeFilledText(value)
    ) {
      const actualLength =
        typeof actual === "string" ? normalizeFilledText(actual).length : 0;
      throw new Error(
        `filled_value_mismatch(expected_length=${normalizeFilledText(value).length}, actual_length=${actualLength})`,
      );
    }
  }

  async typeText(
    target: ElementReference,
    value: string,
    delayMs = 0,
  ): Promise<void> {
    const locator = this.locatorFor(target);
    await focusAtTextEnd(locator);
    await locator.pressSequentially(value, { delay: delayMs });
  }

  async pressKey(target: ElementReference, key: AutomationKey): Promise<void> {
    const locator = this.locatorFor(target);
    await focusAtTextEnd(locator);
    await locator.press(key);
  }

  async uploadFiles(
    target: ElementReference,
    filePaths: readonly string[],
  ): Promise<void> {
    assertAbsoluteFilePaths(filePaths);
    await this.locatorFor(target).setInputFiles([...filePaths]);
  }

  async dropFiles(
    target: ElementReference,
    filePaths: readonly string[],
  ): Promise<void> {
    assertAbsoluteFilePaths(filePaths);
    const payload = await Promise.all(
      filePaths.map(async (filePath) => ({
        name: basename(filePath),
        type: mediaType(filePath),
        base64: (await readFile(filePath)).toString("base64"),
      })),
    );
    const dataTransfer = await this.page.evaluateHandle((files) => {
      const browser = globalThis as unknown as {
        atob(value: string): string;
        DataTransfer: new () => { items: { add(file: unknown): void } };
        File: new (
          parts: readonly unknown[],
          name: string,
          options: { type: string },
        ) => unknown;
      };
      const transfer = new browser.DataTransfer();
      for (const file of files) {
        const bytes = Uint8Array.from(browser.atob(file.base64), (character) =>
          character.charCodeAt(0),
        );
        transfer.items.add(
          new browser.File([bytes], file.name, { type: file.type }),
        );
      }
      return transfer;
    }, payload);
    try {
      const locator = this.locatorFor(target);
      await locator.dispatchEvent("dragover", { dataTransfer });
      await locator.dispatchEvent("drop", { dataTransfer });
    } finally {
      await dataTransfer.dispose();
    }
  }

  async textContent(target: ElementReference): Promise<string | null> {
    return this.locatorFor(target).textContent();
  }

  async attribute(
    target: ElementReference,
    name: string,
  ): Promise<string | null> {
    return this.locatorFor(target).getAttribute(name);
  }

  async captureEvidence(reason: string): Promise<EvidenceReference> {
    const id = randomUUID();
    await mkdir(this.evidenceDirectory, { recursive: true });
    await this.page.screenshot({
      path: join(this.evidenceDirectory, `${id}.png`),
      fullPage: true,
    });
    return { id, capturedAt: new Date().toISOString(), reason };
  }

  private locatorFor(reference: ElementReference): Locator {
    const locator = this.locators.get(reference.id);
    if (!locator) throw new Error("page_changed");
    return locator;
  }

  private remember(id: string, locator: Locator): void {
    this.locators.set(id, locator);
    if (this.locators.size <= MAX_ELEMENT_REFERENCES) return;
    const oldestId = this.locators.keys().next().value as string | undefined;
    if (oldestId) this.locators.delete(oldestId);
  }
}
