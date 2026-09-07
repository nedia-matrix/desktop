import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { isAbsolute } from "node:path";

import type { SessionDetectionPlan } from "@nedia-matrix/automation-contracts";
import type {
  PlatformBrowserPolicy,
  PublishObservationSession,
} from "@nedia-matrix/platform-core";
import { chromium, type BrowserContext, type Page } from "playwright";

import { PlaywrightAutomationDriver } from "./automation-driver.js";
import { isAllowedPlatformNavigation } from "./navigation-policy.js";
import { createPlaywrightPublishObservationSession } from "./publish-observation-session.js";
import {
  createPlaywrightSessionProbeClient,
  type PlaywrightSessionProbeClient,
} from "./session-probe-client.js";

export interface OpenPersistentBrowserSessionOptions {
  browser: PlatformBrowserPolicy;
  sessionDetection: SessionDetectionPlan;
  profileDirectory: string;
  profileId: string;
  evidenceDirectory: string;
}

export interface OpenedPersistentBrowserSession {
  id: string;
  profileId: string;
  context: BrowserContext;
  page: Page;
  driver: PlaywrightAutomationDriver;
  sessionProbeClient: PlaywrightSessionProbeClient;
  observationSession: PublishObservationSession;
  focus(): Promise<void>;
  close(): Promise<void>;
}

interface BrowserLaunchCandidate {
  name: string;
  options: PersistentBrowserOptions;
}

type PersistentBrowserOptions = NonNullable<
  Parameters<typeof chromium.launchPersistentContext>[1]
>;

export function browserLaunchCandidates(): BrowserLaunchCandidate[] {
  return [
    { name: "Google Chrome", options: { channel: "chrome" } },
    { name: "Microsoft Edge", options: { channel: "msedge" } },
    { name: "Playwright Chromium", options: {} },
  ];
}

async function launchPersistentBrowser(
  profileDirectory: string,
): Promise<BrowserContext> {
  const failures: string[] = [];
  const sharedOptions: PersistentBrowserOptions = {
    headless: false,
    chromiumSandbox: true,
    viewport: null,
    acceptDownloads: true,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  };

  for (const candidate of browserLaunchCandidates()) {
    try {
      return await chromium.launchPersistentContext(profileDirectory, {
        ...sharedOptions,
        ...candidate.options,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      failures.push(`${candidate.name}: ${detail}`);
    }
  }

  throw new Error(
    `Unable to start a supported browser. Install Google Chrome or Microsoft Edge and try again. ${failures.join("\n")}`,
  );
}

export async function openPersistentBrowserSession(
  options: OpenPersistentBrowserSessionOptions,
): Promise<OpenedPersistentBrowserSession> {
  if (!isAbsolute(options.profileDirectory)) {
    throw new TypeError("Browser profile directory must be an absolute path");
  }
  await mkdir(options.profileDirectory, { recursive: true });

  let context: BrowserContext;
  try {
    context = await launchPersistentBrowser(options.profileDirectory);
    await context.addInitScript(`
      Object.defineProperty(Navigator.prototype, "webdriver", {
        configurable: true,
        get: () => false,
      });
    `);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to start the browser. ${detail}`);
  }

  try {
    const existingPage = context
      .pages()
      .find((candidate) =>
        isAllowedPlatformNavigation(candidate.url(), options.browser),
      );
    const page =
      existingPage ?? context.pages()[0] ?? (await context.newPage());
    const sessionProbeClient = createPlaywrightSessionProbeClient(
      context,
      page,
      options.browser,
      options.sessionDetection,
    );
    if (!isAllowedPlatformNavigation(page.url(), options.browser)) {
      await page.goto(options.browser.startUrl, {
        waitUntil: "domcontentloaded",
      });
    }

    const driver = new PlaywrightAutomationDriver(
      page,
      options.browser,
      options.evidenceDirectory,
    );
    return {
      id: randomUUID(),
      profileId: options.profileId,
      context,
      page,
      driver,
      sessionProbeClient,
      observationSession: await createPlaywrightPublishObservationSession(
        context,
        page,
      ),
      async focus() {
        await page.bringToFront();
      },
      async close() {
        sessionProbeClient.dispose();
        await context.close();
      },
    };
  } catch (error) {
    await context.close().catch(() => undefined);
    throw error;
  }
}
