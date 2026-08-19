import type { SessionDetectionPlan } from "@nedia-matrix/automation-contracts";
import { z } from "zod";

import type { PlatformPublishFormCapability } from "./publishing.js";
import type { PlatformPublishRuntime } from "./runtime.js";

export const platformImplementationStatusSchema = z.enum([
  "route-only",
  "reference-derived",
  "fixture-tested",
  "live-tested",
]);
export type PlatformImplementationStatus = z.infer<
  typeof platformImplementationStatusSchema
>;

export interface PlatformLoginEntry {
  readonly id: string;
  readonly displayName: string;
  readonly url: string;
}

export interface PlatformBrowserPolicy {
  readonly startUrl: string;
  readonly allowedHostSuffixes: readonly string[];
}

export interface PlatformAccountsCapability {
  readonly implementationStatus: PlatformImplementationStatus;
  readonly loginEntries: readonly PlatformLoginEntry[];
  readonly detection: SessionDetectionPlan;
}

export interface PlatformPublishingCapability {
  readonly implementationStatus: PlatformImplementationStatus;
  readonly forms: Readonly<
    Partial<
      Record<"video" | "imageText" | "longText", PlatformPublishFormCapability>
    >
  >;
  createResultMonitor: PlatformPublishRuntime["createResultMonitor"];
}

export interface PlatformModule {
  readonly id: string;
  readonly displayName: string;
  readonly rulesVersion: string;
  readonly browser: PlatformBrowserPolicy;
  readonly accounts: PlatformAccountsCapability;
  readonly publishing?: PlatformPublishingCapability;
}

const urlSchema = z.string().url();
const requiredString = z.string().min(1);

function addressOf(url: string): {
  protocol: "http" | "https";
  hostname: string;
} {
  const match = /^(https?):\/\/([^/:?#]+)(?::\d+)?(?:[/?#]|$)/i.exec(url);
  if (!match?.[1] || !match[2]) {
    throw new TypeError(`Unsupported platform URL: ${url}`);
  }
  return {
    protocol: match[1].toLowerCase() as "http" | "https",
    hostname: match[2].toLowerCase(),
  };
}

export function isAllowedPlatformUrl(
  browser: PlatformBrowserPolicy,
  url: string,
): boolean {
  const { protocol, hostname } = addressOf(url);
  if (
    protocol !== "https" &&
    hostname !== "localhost" &&
    hostname !== "127.0.0.1"
  ) {
    return false;
  }
  return browser.allowedHostSuffixes.some((suffix) => {
    const normalized = suffix.toLowerCase();
    return hostname === normalized || hostname.endsWith(`.${normalized}`);
  });
}

function assertAllowedUrl(
  module: PlatformModule,
  path: string,
  url: string,
): void {
  urlSchema.parse(url);
  if (!isAllowedPlatformUrl(module.browser, url)) {
    throw new TypeError(`${path} is outside allowed platform hosts: ${url}`);
  }
}

function workflowUrls(module: PlatformModule): readonly [string, string][] {
  const result: [string, string][] = [];
  for (const [formName, form] of Object.entries(
    module.publishing?.forms ?? {},
  )) {
    if (!form) continue;
    for (const [workflowName, workflow] of Object.entries(form.automation)) {
      if (workflow?.startUrl) {
        result.push([
          `publishing.forms.${formName}.automation.${workflowName}.startUrl`,
          workflow.startUrl,
        ]);
      }
    }
  }
  return result;
}

export function definePlatformModule(module: PlatformModule): PlatformModule {
  requiredString.parse(module.id);
  requiredString.parse(module.displayName);
  requiredString.parse(module.rulesVersion);
  if (module.browser.allowedHostSuffixes.length === 0) {
    throw new TypeError("A platform must allow at least one host suffix");
  }
  for (const suffix of module.browser.allowedHostSuffixes) {
    requiredString.parse(suffix);
  }
  platformImplementationStatusSchema.parse(
    module.accounts.implementationStatus,
  );
  if (module.publishing) {
    platformImplementationStatusSchema.parse(
      module.publishing.implementationStatus,
    );
    if (Object.keys(module.publishing.forms).length === 0) {
      throw new TypeError(
        "Publishing capability must define at least one form",
      );
    }
  }

  assertAllowedUrl(module, "browser.startUrl", module.browser.startUrl);
  const loginEntryIds = new Set<string>();
  for (const entry of module.accounts.loginEntries) {
    requiredString.parse(entry.id);
    requiredString.parse(entry.displayName);
    if (loginEntryIds.has(entry.id)) {
      throw new TypeError(`Duplicate login entry: ${entry.id}`);
    }
    loginEntryIds.add(entry.id);
    assertAllowedUrl(
      module,
      `accounts.loginEntries.${entry.id}.url`,
      entry.url,
    );
  }
  for (const [index, probe] of module.accounts.detection.probes.entries()) {
    assertAllowedUrl(
      module,
      `accounts.detection.probes.${index}.source.url`,
      probe.source.url,
    );
  }
  for (const [path, url] of workflowUrls(module)) {
    assertAllowedUrl(module, path, url);
  }
  return module;
}
