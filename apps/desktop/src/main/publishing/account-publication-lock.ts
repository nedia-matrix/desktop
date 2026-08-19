export interface AccountPublicationLease {
  release(): void;
}

export class AccountPublicationLock {
  private readonly activeAccountIds = new Set<string>();

  acquire(accountId: string): AccountPublicationLease | null {
    if (this.activeAccountIds.has(accountId)) return null;
    this.activeAccountIds.add(accountId);

    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.activeAccountIds.delete(accountId);
      },
    };
  }
}
