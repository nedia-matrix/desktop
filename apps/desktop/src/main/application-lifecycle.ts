export type WindowOpenDecision = "open-now" | "relaunch-after-shutdown";

export class ApplicationLifecycle {
  private shutdownStarted = false;
  private relaunchRequested = false;

  requestWindowOpen(): WindowOpenDecision {
    if (!this.shutdownStarted) return "open-now";
    this.relaunchRequested = true;
    return "relaunch-after-shutdown";
  }

  beginShutdown(): boolean {
    if (this.shutdownStarted) return false;
    this.shutdownStarted = true;
    return true;
  }

  shouldRelaunchAfterShutdown(): boolean {
    return this.relaunchRequested;
  }
}
