import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join } from "node:path";

import type {
  AutomationKey,
  AutomationDriver,
  ElementReference,
  EvidenceReference,
  LocatorCandidate,
} from "@nedia-matrix/automation-engine";
import type { PlatformBrowserPolicy } from "@nedia-matrix/platform-sdk";
import type { ElementHandle, FileChooser, Locator, Page } from "playwright";

import { isAllowedPlatformNavigation } from "./navigation-policy.js";

const MAX_ELEMENT_REFERENCES = 500;
const MAX_QUERY_MATCHES = 100;
const SHADOW_CLICK_MARKER = "data-nedia-shadow-click";
const TYPING_DELAY_MS = 20;
const INPUT_SETTLE_MS = 100;
const FILE_CHOOSER_TIMEOUT_MS = 5_000;

type LocatorRoot = Page | Locator;

interface CdpDomNode {
  nodeId: number;
  nodeName: string;
  attributes?: string[];
  children?: CdpDomNode[];
  shadowRoots?: CdpDomNode[];
}

function attribute(node: CdpDomNode, name: string): string | null {
  const attributes = node.attributes ?? [];
  for (let index = 0; index < attributes.length; index += 2) {
    if (attributes[index] === name) return attributes[index + 1] ?? "";
  }
  return null;
}

function walkDom(
  node: CdpDomNode,
  visitor: (candidate: CdpDomNode) => boolean,
): CdpDomNode | null {
  if (visitor(node)) return node;
  for (const child of [...(node.children ?? []), ...(node.shadowRoots ?? [])]) {
    const match = walkDom(child, visitor);
    if (match) return match;
  }
  return null;
}

export function findClosedShadowDescendant(
  root: CdpDomNode,
  marker: string,
  descendantTag: string,
  descendantClass: string,
): CdpDomNode | null {
  const host = walkDom(
    root,
    (node) => attribute(node, SHADOW_CLICK_MARKER) === marker,
  );
  if (!host) return null;
  const tag = descendantTag.toUpperCase();
  const matches = (node: CdpDomNode): boolean =>
    node.nodeName === tag &&
    (attribute(node, "class") ?? "").split(/\s+/).includes(descendantClass);
  for (const shadowRoot of host.shadowRoots ?? []) {
    const match = walkDom(shadowRoot, matches);
    if (match) return match;
  }
  return null;
}

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

  async clickAtPosition(
    target: ElementReference,
    xRatio: number,
    yRatio: number,
  ): Promise<void> {
    const locator = this.locatorFor(target);
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (!box || box.width <= 0 || box.height <= 0) {
      throw new Error("target_has_no_clickable_box");
    }
    await this.page.mouse.click(
      box.x + box.width * xRatio,
      box.y + box.height * yRatio,
    );
  }

  async clickClosedShadowDescendant(
    target: ElementReference,
    descendantTag: string,
    descendantClass: string,
  ): Promise<void> {
    const locator = this.locatorFor(target);
    const marker = randomUUID();
    await locator.evaluate(
      (element, input) => element.setAttribute(input.name, input.value),
      { name: SHADOW_CLICK_MARKER, value: marker },
    );
    const cdp = await this.page.context().newCDPSession(this.page);
    try {
      const { root } = await cdp.send("DOM.getDocument", {
        depth: -1,
        pierce: true,
      });
      const descendant = findClosedShadowDescendant(
        root as CdpDomNode,
        marker,
        descendantTag,
        descendantClass,
      );
      if (!descendant) throw new Error("closed_shadow_target_not_found");
      const { model } = await cdp.send("DOM.getBoxModel", {
        nodeId: descendant.nodeId,
      });
      const [x1, y1, x2, y2, x3, y3, x4, y4] = model.content;
      if ([x1, y1, x2, y2, x3, y3, x4, y4].some((value) => value == null)) {
        throw new Error("closed_shadow_target_has_no_box");
      }
      const x = (x1! + x2! + x3! + x4!) / 4;
      const y = (y1! + y2! + y3! + y4!) / 4;
      await this.page.mouse.click(x, y);
    } finally {
      await cdp.detach().catch(() => undefined);
      await locator
        .evaluate(
          (element, name) => element.removeAttribute(name),
          SHADOW_CLICK_MARKER,
        )
        .catch(() => undefined);
    }
  }

  async fill(target: ElementReference, value: string): Promise<void> {
    const locator = this.locatorFor(target);
    const contentEditable = await locator.evaluate(
      (element) => element.getAttribute("contenteditable") === "true",
    );
    await locator.click();
    await delay(INPUT_SETTLE_MS);
    await locator.press("ControlOrMeta+A");
    await locator.press("Backspace");
    const deadline =
      Date.now() + 30_000 + Array.from(value).length * TYPING_DELAY_MS * 2;
    for (const part of value.match(/ +|[^ ]+/g) ?? []) {
      if (part.startsWith(" ")) {
        // Body spaces are text, not Space shortcuts that rich editors use to commit topics.
        // Insert one at a time to preserve the normal typing pace and input event granularity.
        await locator.focus();
        for (const space of part) {
          await this.page.keyboard.insertText(space);
          await delay(TYPING_DELAY_MS);
        }
      } else {
        await locator.pressSequentially(part, {
          delay: TYPING_DELAY_MS,
          timeout: Math.max(1, deadline - Date.now()),
        });
      }
    }
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
    delayMs = TYPING_DELAY_MS,
  ): Promise<void> {
    const locator = this.locatorFor(target);
    await focusAtTextEnd(locator);
    await delay(INPUT_SETTLE_MS);
    await locator.pressSequentially(value, {
      delay: delayMs,
      timeout: 30_000 + Array.from(value).length * delayMs * 2,
    });
  }

  async pressKey(target: ElementReference, key: AutomationKey): Promise<void> {
    const locator = this.locatorFor(target);
    await focusAtTextEnd(locator);
    await delay(INPUT_SETTLE_MS);
    await locator.press(key);
  }

  async uploadFiles(
    target: ElementReference,
    filePaths: readonly string[],
  ): Promise<void> {
    assertAbsoluteFilePaths(filePaths);
    const input = this.locatorFor(target);
    // Only standard HTML associations are inferred; custom upload buttons are not guessed.
    const handle = await input.evaluateHandle((element) => {
      const fileInput = element as unknown as {
        tagName: string;
        type: string;
        disabled: boolean;
        labels?: ArrayLike<typeof element>;
      };
      if (
        fileInput.tagName !== "INPUT" ||
        fileInput.type !== "file" ||
        fileInput.disabled
      )
        return null;
      return (
        [...Array.from(fileInput.labels ?? []), element].find((candidate) => {
          const style =
            candidate.ownerDocument.defaultView?.getComputedStyle(candidate);
          const rect = candidate.getBoundingClientRect();
          return (
            style &&
            style.visibility !== "hidden" &&
            style.visibility !== "collapse" &&
            style.pointerEvents !== "none" &&
            rect.width > 0 &&
            rect.height > 0
          );
        }) ?? null
      );
    });
    try {
      const trigger = handle.asElement();
      // A visible file input may sit underneath a custom upload button. Trial
      // checks actionability without clicking or opening a chooser.
      let clickable = false;
      if (trigger) {
        try {
          await trigger.click({
            trial: true,
            timeout: FILE_CHOOSER_TIMEOUT_MS,
          });
          clickable = true;
        } catch (error) {
          if (!(error instanceof Error) || error.name !== "TimeoutError") {
            throw error;
          }
        }
      }
      if (!trigger || !clickable) {
        await delay(INPUT_SETTLE_MS);
        await input.setInputFiles([...filePaths]);
        return;
      }
      await this.uploadThroughChooser(input, trigger, filePaths);
    } finally {
      await handle.dispose();
    }
  }

  private async uploadThroughChooser(
    input: Locator,
    trigger: ElementHandle,
    filePaths: readonly string[],
  ): Promise<void> {
    let onChooser!: (chooser: FileChooser) => void;
    let onClose!: () => void;
    let cancelWait!: (error: Error) => void;
    const controller = new AbortController();
    let timer!: ReturnType<typeof setTimeout>;
    const chooserPromise = new Promise<FileChooser>((resolve, reject) => {
      cancelWait = reject;
      onChooser = resolve;
      onClose = () => reject(new Error("file_chooser_page_closed"));
      this.page.on("filechooser", onChooser);
      this.page.on("close", onClose);
    });
    try {
      // Attach both rejection handlers before clicking; either operation may fail first.
      const [chooser] = await Promise.all([
        chooserPromise,
        trigger
          .click({
            timeout: FILE_CHOOSER_TIMEOUT_MS,
            signal: controller.signal,
          })
          .then(() => {
            if (controller.signal.aborted) return;
            // Only time the chooser after the click completes, so a blocked
            // click retains Playwright's actionable diagnostic instead.
            timer = setTimeout(
              () => cancelWait(new Error("file_chooser_timeout")),
              FILE_CHOOSER_TIMEOUT_MS,
            );
          }),
      ]);
      if (
        !(await input.evaluate(
          (element, selected) => element === selected,
          chooser.element(),
        ))
      ) {
        throw new Error("file_chooser_target_mismatch");
      }
      await delay(INPUT_SETTLE_MS);
      await chooser.setFiles([...filePaths], {
        timeout: FILE_CHOOSER_TIMEOUT_MS,
      });
    } finally {
      controller.abort();
      cancelWait(new Error("file_chooser_wait_finished"));
      clearTimeout(timer);
      this.page.off("filechooser", onChooser);
      this.page.off("close", onClose);
    }
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
