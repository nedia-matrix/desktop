import type {
  AccountInfoFieldDefinition,
  AccountInfoItem,
  AutomationDriver,
  AutomationPage,
  FieldPath,
  PlatformSessionDetection,
  SessionDetectionPlan,
  SessionProbe,
  SessionProbeClient,
  SessionProbeResponse,
} from "@nedia-matrix/automation-contracts";
import { z } from "zod";

import { AutomationDefinitionError } from "./errors.js";
import { findTargetMatches } from "./target-resolution.js";

const fieldPathSchema = z
  .array(z.union([z.string().min(1), z.number().int().nonnegative()]))
  .min(1);
const accountInfoKeySchema = z.enum([
  "desc",
  "follower_count",
  "content_count",
  "like_count",
]);
const accountInfoFieldSchema = z.object({
  key: accountInfoKeySchema,
  valuePath: fieldPathSchema,
  valueType: z.enum(["string", "number"]),
});
const sessionProbeSchema = z.object({
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("request"), url: z.string().url() }),
    z.object({
      kind: z.literal("observed-response"),
      method: z.enum(["GET", "POST"]),
      url: z.string().url(),
      timeoutMs: z.number().int().positive().max(30_000).default(1_500),
    }),
  ]),
  fields: z.object({
    externalAccountId: fieldPathSchema,
    nickname: fieldPathSchema,
    avatarUrl: fieldPathSchema.optional(),
  }),
  accountInfo: z.array(accountInfoFieldSchema).optional(),
});
const sessionDetectionPlanSchema = z.object({
  probes: z.array(sessionProbeSchema).default([]),
  domFallback: z
    .object({
      page: z.custom<AutomationPage>(),
      loggedOutTargetId: z.string().min(1),
      nicknameTargetId: z.string().min(1),
      accountIdTargetId: z.string().min(1),
      accountIdAttributes: z.array(z.string().min(1)).min(1),
    })
    .optional(),
});

export type SessionDetectionPlanInput = z.input<
  typeof sessionDetectionPlanSchema
>;

export function defineSessionDetectionPlan(
  input: SessionDetectionPlanInput,
): SessionDetectionPlan {
  const plan = sessionDetectionPlanSchema.parse(input) as SessionDetectionPlan;
  const issues: {
    code: "INVALID_REFERENCE";
    path: readonly (string | number)[];
    message: string;
  }[] = [];
  for (const [probeIndex, probe] of plan.probes.entries()) {
    const keys = new Set<string>();
    for (const [fieldIndex, field] of (probe.accountInfo ?? []).entries()) {
      if (keys.has(field.key)) {
        issues.push({
          code: "INVALID_REFERENCE",
          path: ["probes", probeIndex, "accountInfo", fieldIndex, "key"],
          message: `Duplicate account info key: ${field.key}`,
        });
      }
      keys.add(field.key);
    }
  }
  const fallback = plan.domFallback;
  if (fallback) {
    for (const [name, targetId] of [
      ["loggedOutTargetId", fallback.loggedOutTargetId],
      ["nicknameTargetId", fallback.nicknameTargetId],
      ["accountIdTargetId", fallback.accountIdTargetId],
    ] as const) {
      if (!fallback.page.targets[targetId]) {
        issues.push({
          code: "INVALID_REFERENCE",
          path: ["domFallback", name],
          message: `Unknown target: ${targetId}`,
        });
      }
    }
  }
  if (issues.length > 0) throw new AutomationDefinitionError(issues);
  return plan;
}

function valueAtPath(value: unknown, path: FieldPath): unknown {
  let current = value;
  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Array.isArray(current)) return undefined;
      current = current[segment];
    } else {
      if (typeof current !== "object" || current === null) return undefined;
      current = (current as Record<string, unknown>)[segment];
    }
  }
  return current;
}

function scalarString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function accountInfoValue(
  value: unknown,
  definition: AccountInfoFieldDefinition,
): string | number | null {
  if (definition.valueType === "string") return scalarString(value);
  let number = Number.NaN;
  if (typeof value === "number") number = value;
  if (typeof value === "string" && value.trim()) number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function authenticatedDetection(
  body: unknown,
  probe: SessionProbe,
  source: "api" | "response",
): PlatformSessionDetection | null {
  const externalAccountId = scalarString(
    valueAtPath(body, probe.fields.externalAccountId),
  );
  const nickname = scalarString(valueAtPath(body, probe.fields.nickname));
  if (!externalAccountId || !nickname) return null;
  const accountInfo: AccountInfoItem[] = (probe.accountInfo ?? []).flatMap(
    (definition) => {
      const value = accountInfoValue(
        valueAtPath(body, definition.valuePath),
        definition,
      );
      return value === null ? [] : [{ key: definition.key, value }];
    },
  );
  return {
    status: "authenticated",
    externalAccountId,
    nickname,
    avatarUrl: probe.fields.avatarUrl
      ? scalarString(valueAtPath(body, probe.fields.avatarUrl))
      : null,
    accountInfo,
    source,
  };
}

async function readProbe(
  probe: SessionProbe,
  client: SessionProbeClient,
): Promise<{
  source: "api" | "response";
  response: SessionProbeResponse | null;
}> {
  if (probe.source.kind === "request") {
    return {
      source: "api",
      response: await client.fetchJson(probe.source.url),
    };
  }
  return {
    source: "response",
    response: await client.waitForJsonResponse(probe.source),
  };
}

export async function detectPlatformSession(
  plan: SessionDetectionPlan,
  driver: AutomationDriver,
  client: SessionProbeClient,
): Promise<PlatformSessionDetection> {
  let unauthorizedSource: "api" | "response" | undefined;
  for (const probe of plan.probes) {
    try {
      const { response, source } = await readProbe(probe, client);
      if (!response) continue;
      if (response.status === 401 || response.status === 403) {
        unauthorizedSource = source;
        continue;
      }
      if (!response.ok) continue;
      const detected = authenticatedDetection(response.body, probe, source);
      if (detected) return detected;
    } catch {
      // A platform endpoint can be unavailable; continue to later probes and DOM.
    }
  }

  const fallback = plan.domFallback;
  if (fallback) {
    const loggedOut = await findTargetMatches(
      driver,
      fallback.page,
      fallback.loggedOutTargetId,
    );
    if (loggedOut.length > 0) {
      return { status: "login_required", source: "dom" };
    }
    const nicknameTarget = (
      await findTargetMatches(driver, fallback.page, fallback.nicknameTargetId)
    )[0];
    const accountIdTarget = (
      await findTargetMatches(driver, fallback.page, fallback.accountIdTargetId)
    )[0];
    const nickname = nicknameTarget
      ? scalarString(await driver.textContent(nicknameTarget))
      : null;
    let externalAccountId: string | null = null;
    if (accountIdTarget) {
      for (const attribute of fallback.accountIdAttributes) {
        externalAccountId = scalarString(
          await driver.attribute(accountIdTarget, attribute),
        );
        if (externalAccountId) break;
      }
    }
    if (nickname && externalAccountId) {
      return {
        status: "authenticated",
        externalAccountId,
        nickname,
        avatarUrl: null,
        accountInfo: [],
        source: "dom",
      };
    }
  }
  if (unauthorizedSource) {
    return { status: "login_required", source: unauthorizedSource };
  }
  return { status: "unknown", reason: "无法识别当前登录账号" };
}
