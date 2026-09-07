import type { AccountRepository, BrowserSessionPort } from "./account-ports.js";
import type { RetiredBrowserProfile } from "./account-types.js";

interface RetiredProfileCleanerDependencies {
  accountStore: Pick<
    AccountRepository,
    | "discardRetiredProfile"
    | "hasProfileReference"
    | "listRetiredProfiles"
    | "pruneExpiredAliases"
  >;
  browserSessions: Pick<BrowserSessionPort, "removeProfile">;
  now(): Date;
}

export class RetiredProfileCleaner {
  constructor(
    private readonly dependencies: RetiredProfileCleanerDependencies,
  ) {}

  async cleanupDue(): Promise<void> {
    const now = this.dependencies.now();
    this.dependencies.accountStore.pruneExpiredAliases(now);
    const dueProfiles = this.dependencies.accountStore
      .listRetiredProfiles()
      .filter((profile) => profile.removeAfter <= now.toISOString());
    for (const profile of dueProfiles) {
      await this.remove(profile);
    }
  }

  schedule(profile: RetiredBrowserProfile): void {
    const delay = Math.max(
      0,
      new Date(profile.removeAfter).getTime() -
        this.dependencies.now().getTime(),
    );
    const timer = setTimeout(() => {
      void this.remove(profile).catch((error: unknown) => {
        console.error("Failed to remove retired browser profile", error);
      });
    }, delay);
    timer.unref();
  }

  private async remove(profile: RetiredBrowserProfile): Promise<void> {
    if (this.dependencies.accountStore.hasProfileReference(profile.profileId)) {
      console.error(
        "Retired browser profile is still referenced by an account",
      );
      return;
    }
    await this.dependencies.browserSessions.removeProfile(profile.profileId);
    this.dependencies.accountStore.discardRetiredProfile(profile.profileId);
  }
}
