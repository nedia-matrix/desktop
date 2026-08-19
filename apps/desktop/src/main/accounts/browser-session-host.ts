import { rm } from "node:fs/promises";
import { join } from "node:path";

import {
  browserProfileDirectory,
  openPersistentBrowserSession,
  type OpenedPersistentBrowserSession,
} from "@nedia-matrix/automation-playwright";
import type { PlatformAccountSummary } from "@nedia-matrix/ipc-contracts";
import type { PlatformLoginEntry, PlatformModule } from "@nedia-matrix/platform-core";
import { app } from "electron";

interface ProfileEntry {
  accountId: string;
  session: OpenedPersistentBrowserSession;
}

interface BrowserProfileHostDependencies {
  openSession: typeof openPersistentBrowserSession;
  removeProfileDirectory: typeof rm;
  profilesRoot(): string;
  evidenceRoot(): string;
}

const defaultDependencies: BrowserProfileHostDependencies = {
  openSession: openPersistentBrowserSession,
  removeProfileDirectory: rm,
  profilesRoot: () => join(app.getPath("userData"), "browser-profiles"),
  evidenceRoot: () => join(app.getPath("userData"), "automation-evidence"),
};

export class BrowserProfileHost {
  private readonly profiles = new Map<string, ProfileEntry>();
  private readonly transitions = new Map<string, Promise<void>>();

  constructor(
    private readonly onSessionClosed: (accountId: string) => void,
    private readonly dependencies: BrowserProfileHostDependencies = defaultDependencies,
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
        await existing.session.focus();
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

  async closeAutomation(account: PlatformAccountSummary): Promise<void> {
    await this.withProfileTransition(account.profileId, async () => {
      const existing = this.profiles.get(account.profileId);
      if (!existing) return;
      this.profiles.delete(account.profileId);
      await existing.session.close().catch(() => undefined);
    });
  }

  async remove(account: PlatformAccountSummary): Promise<void> {
    await this.withProfileTransition(account.profileId, async () => {
      const existing = this.profiles.get(account.profileId);
      this.profiles.delete(account.profileId);
      await this.closeEntry(existing);
      await this.dependencies.removeProfileDirectory(
        this.profileDirectory(account.profileId),
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
