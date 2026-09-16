import { readdir, rm, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const LOG_FILE_PATTERN = /^automation-\d{4}-\d{2}-\d{2}(?:\.\d+)?\.jsonl$/;
const TRACE_DIRECTORY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface RetentionEntry {
  readonly path: string;
  readonly modifiedAt: number;
  readonly size: number;
  readonly kind: "log" | "evidence";
  readonly traceId?: string;
}

export interface AutomationDiagnosticRetentionOptions {
  readonly logDirectory: string;
  readonly evidenceDirectory: string;
  readonly activeLogPath?: string;
  readonly protectedTraceIds?: ReadonlySet<string>;
  readonly maxAgeMs?: number;
  readonly maxTotalBytes?: number;
  readonly now?: () => number;
}

export async function enforceAutomationDiagnosticRetention(
  options: AutomationDiagnosticRetentionOptions,
): Promise<void> {
  const entries = [
    ...(await logEntries(options.logDirectory)),
    ...(await evidenceEntries(options.evidenceDirectory)),
  ];
  const protectedPaths = new Set(
    options.activeLogPath ? [resolve(options.activeLogPath)] : [],
  );
  const protectedTraceIds = options.protectedTraceIds ?? new Set<string>();
  const cutoff =
    (options.now ?? Date.now)() -
    (options.maxAgeMs ?? 14 * 24 * 60 * 60 * 1_000);
  const removable = entries
    .filter(
      (entry) =>
        !protectedPaths.has(resolve(entry.path)) &&
        !(entry.traceId && protectedTraceIds.has(entry.traceId)),
    )
    .sort((left, right) => left.modifiedAt - right.modifiedAt);
  const removed = new Set<string>();
  for (const entry of removable) {
    if (entry.modifiedAt >= cutoff) continue;
    await removeEntry(entry);
    removed.add(entry.path);
  }

  let total = entries
    .filter((entry) => !removed.has(entry.path))
    .reduce((sum, entry) => sum + entry.size, 0);
  const maxTotalBytes = options.maxTotalBytes ?? 100 * 1024 * 1024;
  for (const entry of removable) {
    if (total <= maxTotalBytes) break;
    if (removed.has(entry.path)) continue;
    await removeEntry(entry);
    removed.add(entry.path);
    total -= entry.size;
  }
}

async function logEntries(directory: string): Promise<RetentionEntry[]> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return [];
  }
  const entries: RetentionEntry[] = [];
  for (const name of names) {
    if (!LOG_FILE_PATTERN.test(name) || basename(name) !== name) continue;
    const path = join(directory, name);
    try {
      const metadata = await stat(path);
      if (!metadata.isFile()) continue;
      entries.push({
        path,
        modifiedAt: metadata.mtimeMs,
        size: metadata.size,
        kind: "log",
      });
    } catch {
      // A concurrently removed entry is already clean.
    }
  }
  return entries;
}

async function evidenceEntries(directory: string): Promise<RetentionEntry[]> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return [];
  }
  const entries: RetentionEntry[] = [];
  for (const traceId of names) {
    if (
      !TRACE_DIRECTORY_PATTERN.test(traceId) ||
      basename(traceId) !== traceId
    ) {
      continue;
    }
    const path = join(directory, traceId);
    try {
      const metadata = await stat(path);
      if (!metadata.isDirectory()) continue;
      entries.push({
        path,
        modifiedAt: metadata.mtimeMs,
        size: await evidenceDirectorySize(path),
        kind: "evidence",
        traceId,
      });
    } catch {
      // A concurrently removed entry is already clean.
    }
  }
  return entries;
}

async function evidenceDirectorySize(directory: string): Promise<number> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return 0;
  }
  let total = 0;
  for (const name of names) {
    if (!/^[0-9a-f-]+\.png$/i.test(name) || basename(name) !== name) continue;
    try {
      const metadata = await stat(join(directory, name));
      if (metadata.isFile()) total += metadata.size;
    } catch {
      // A concurrently removed screenshot is already clean.
    }
  }
  return total;
}

async function removeEntry(entry: RetentionEntry): Promise<void> {
  if (entry.kind === "log") {
    await rm(entry.path, { force: true });
  } else {
    await rm(entry.path, { recursive: true, force: true });
  }
}
