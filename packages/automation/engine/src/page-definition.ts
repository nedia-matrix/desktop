import type {
  AutomationPage,
  ConditionDefinition,
} from "@nedia-matrix/automation-contracts";
import { z } from "zod";

import {
  AutomationDefinitionError,
  type AutomationDefinitionIssue,
} from "./errors.js";

export const textRuleSchema = z.object({
  value: z.string().min(1),
  exact: z.boolean().default(true),
});

export const locatorCandidateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("test-id"), value: z.string().min(1) }),
  z.object({
    kind: z.literal("aria"),
    role: z.string().min(1).optional(),
    name: textRuleSchema.optional(),
  }),
  z.object({ kind: z.literal("label"), text: textRuleSchema }),
  z.object({ kind: z.literal("text"), text: textRuleSchema }),
  z.object({ kind: z.literal("css"), selector: z.string().min(1) }),
]);

export const domTargetDefinitionSchema = z.object({
  candidates: z.array(locatorCandidateSchema).min(1),
  expectedCount: z.enum(["one", "one-or-more"]).default("one"),
  conditions: z
    .array(z.enum(["attached", "visible", "enabled", "editable"]))
    .default(["attached", "visible"]),
});

export const conditionDefinitionSchema: z.ZodType<ConditionDefinition> = z.lazy(
  () =>
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("url"), pattern: z.string().min(1) }),
      z.object({
        kind: z.literal("target"),
        targetId: z.string().min(1),
        state: z.enum(["attached", "visible", "enabled", "editable"]),
      }),
      z.object({
        kind: z.literal("all"),
        conditions: z.array(conditionDefinitionSchema).min(1),
      }),
      z.object({
        kind: z.literal("any"),
        conditions: z.array(conditionDefinitionSchema).min(1),
      }),
      z.object({
        kind: z.literal("not"),
        condition: conditionDefinitionSchema,
      }),
    ]),
);

export const automationPageSchema = z.object({
  id: z.string().min(1),
  states: z.record(z.string(), conditionDefinitionSchema).default({}),
  targets: z.record(z.string(), domTargetDefinitionSchema),
});

export type AutomationPageInput = z.input<typeof automationPageSchema>;

function validateCondition(
  page: AutomationPage,
  condition: ConditionDefinition,
  path: readonly (string | number)[],
  issues: AutomationDefinitionIssue[],
): void {
  switch (condition.kind) {
    case "url":
      try {
        new RegExp(condition.pattern);
      } catch {
        issues.push({
          code: "INVALID_PATTERN",
          path: [...path, "pattern"],
          message: `Invalid regular expression: ${condition.pattern}`,
        });
      }
      return;
    case "target":
      if (!page.targets[condition.targetId]) {
        issues.push({
          code: "INVALID_REFERENCE",
          path: [...path, "targetId"],
          message: `Unknown target: ${condition.targetId}`,
        });
      }
      return;
    case "all":
    case "any":
      condition.conditions.forEach((child, index) =>
        validateCondition(page, child, [...path, "conditions", index], issues),
      );
      return;
    case "not":
      validateCondition(
        page,
        condition.condition,
        [...path, "condition"],
        issues,
      );
  }
}

export function defineAutomationPage(
  input: AutomationPageInput,
): AutomationPage {
  const page = automationPageSchema.parse(input);
  const issues: AutomationDefinitionIssue[] = [];
  for (const [stateId, condition] of Object.entries(page.states)) {
    validateCondition(page, condition, ["states", stateId], issues);
  }
  if (issues.length > 0) throw new AutomationDefinitionError(issues);
  return page;
}
