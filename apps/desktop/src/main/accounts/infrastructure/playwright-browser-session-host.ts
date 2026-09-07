import { rm } from "node:fs/promises";
import { join } from "node:path";

import {
  browserProfileDirectory,
  createPlaywrightSessionProbeClient,
  openPersistentBrowserSession,
  PlaywrightAutomationDriver,
  type OpenedPersistentBrowserSession,
} from "@nedia-matrix/automation-playwright";
import type { PlatformAccountSummary } from "@nedia-matrix/ipc-contracts";
import type {
  PlatformLoginEntry,
  PlatformModule,
} from "@nedia-matrix/platform-core";
import { app } from "electron";

interface ProfileEntry {
  accountId: string;
  session: OpenedPersistentBrowserSession;
}

interface PlaywrightBrowserSessionHostDependencies {
  openSession: typeof openPersistentBrowserSession;
  removeProfileDirectory: typeof rm;
  profilesRoot(): string;
  evidenceRoot(): string;
}

const defaultDependencies: PlaywrightBrowserSessionHostDependencies = {
  openSession: openPersistentBrowserSession,
  removeProfileDirectory: rm,
  profilesRoot: () => join(app.getPath("userData"), "browser-profiles"),
  evidenceRoot: () => join(app.getPath("userData"), "automation-evidence"),
};

export class PlaywrightBrowserSessionHost {
  private readonly profiles = new Map<string, ProfileEntry>();
  private readonly transitions = new Map<string, Promise<void>>();

  constructor(
    private readonly onSessionClosed: (accountId: string) => void,
    private readonly dependencies: PlaywrightBrowserSessionHostDependencies = defaultDependencies,
  ) {}

  get size(): number {
    return this.profiles.size;
  }

  async openForLogin(
    account: PlatformAccountSummary,
    platform: PlatformModule,
    loginEntry: PlatformLoginEntry,
  ): Promise<OpenedPersistentBrowserSession> {
    const opened = await this.openForAutomation(account, platform);
    await opened.driver.navigate(loginEntry.url);
    await opened.focus();
    return opened;
  }

  async openForAutomation(
    account: PlatformAccountSummary,
    platform: PlatformModule,
  ): Promise<OpenedPersistentBrowserSession> {
    return this.withProfileTransition(account.profileId, async () => {
      const existing = this.profiles.get(account.profileId);
      if (existing && !existing.session.page.isClosed()) {
        return existing.session;
      }
      if (existing) {
        this.profiles.delete(account.profileId);
        await existing.session.close().catch(() => undefined);
      }

      const opened = await this.dependencies.openSession({
        browser: platform.browser,
        sessionDetection: platform.accounts.detection,
        profileId: account.profileId,
        profileDirectory: this.profileDirectory(account.profileId),
        evidenceDirectory: join(this.dependencies.evidenceRoot(), account.id),
      });
      const entry: ProfileEntry = {
        accountId: account.id,
        session: opened,
      };
      this.profiles.set(account.profileId, entry);
      opened.context.once("close", () => {
        this.onSessionClosed(account.id);
        if (this.profiles.get(account.profileId) === entry) {
          this.profiles.delete(account.profileId);
        }
      });
      return opened;
    });
  }

  async openForVerification(
    account: PlatformAccountSummary,
    platform: PlatformModule,
  ) {
    const opened = await this.openForAutomation(account, platform);
    const originalPage = opened.page;
    const page = await opened.context.newPage();
    const sessionProbeClient = createPlaywrightSessionProbeClient(
      opened.context,
      page,
      platform.browser,
      platform.accounts.detection,
    );
    const driver = new PlaywrightAutomationDriver(
      page,
      platform.browser,
      join(this.dependencies.evidenceRoot(), account.id),
    );
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      sessionProbeClient.dispose();
      await page.close().catch(() => undefined);
      if (!originalPage.isClosed()) {
        await originalPage.bringToFront().catch(() => undefined);
      }
    };
    try {
      await page.goto(platform.browser.startUrl, {
        waitUntil: "domcontentloaded",
      });
      if (!originalPage.isClosed()) {
        await originalPage.bringToFront().catch(() => undefined);
      }
      return { driver, sessionProbeClient, close };
    } catch (error) {
      await close();
      throw error;
    }
  }

  async closeAutomation(account: PlatformAccountSummary): Promise<void> {
    await this.withProfileTransition(account.profileId, async () => {
      const existing = this.profiles.get(account.profileId);
      if (!existing) return;
      this.profiles.delete(account.profileId);
      await existing.session.close().catch(() => undefined);
    });
  }

  async remove(account: PlatformAccountSummary): Promise<void> {
    await this.removeProfile(account.profileId);
  }

  async removeProfile(profileId: string): Promise<void> {
    await this.withProfileTransition(profileId, async () => {
      const existing = this.profiles.get(profileId);
      this.profiles.delete(profileId);
      await this.closeEntry(existing);
      await this.dependencies.removeProfileDirectory(
        this.profileDirectory(profileId),
        {
          recursive: true,
          force: true,
        },
      );
    });
  }

  async closeAll(): Promise<void> {
    await Promise.allSettled(this.transitions.values());
    const entries = [...this.profiles.values()];
    this.profiles.clear();
    await Promise.allSettled(entries.map((entry) => this.closeEntry(entry)));
  }

  private profilesRoot(): string {
    return this.dependencies.profilesRoot();
  }

  private profileDirectory(profileId: string): string {
    return browserProfileDirectory(this.profilesRoot(), profileId);
  }

  private async closeEntry(entry: ProfileEntry | undefined): Promise<void> {
    if (!entry) return;
    await entry.session.close().catch(() => undefined);
  }

  private async withProfileTransition<T>(
    profileId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.transitions.get(profileId) ?? Promise.resolve();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => gate);
    this.transitions.set(profileId, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.transitions.get(profileId) === queued) {
        this.transitions.delete(profileId);
      }
    }
  }
}
