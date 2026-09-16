import type { ApplicationUpdateCheckResult } from "../../bridge/contracts.js";
import { app, shell } from "electron";

import {
  checkForApplicationUpdate,
  findLatestRelease,
  releasePageUrl,
} from "./application-update.js";

let updateCheckInFlight: Promise<ApplicationUpdateCheckResult> | undefined;

export function checkForApplicationUpdateNow(): Promise<ApplicationUpdateCheckResult> {
  if (updateCheckInFlight) return updateCheckInFlight;

  const check = checkForApplicationUpdate({
    currentVersion: app.getVersion(),
    findLatestRelease,
  });
  updateCheckInFlight = check.finally(() => {
    updateCheckInFlight = undefined;
  });
  return updateCheckInFlight;
}

export async function openApplicationUpdateDownload(
  version: string,
): Promise<void> {
  const pageUrl = releasePageUrl(version);
  if (!pageUrl) throw new TypeError("Application update version is invalid");
  await shell.openExternal(pageUrl);
}
