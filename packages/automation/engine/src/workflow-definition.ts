import type {
  AutomationPage,
  AutomationWorkflow,
  WorkflowInputs,
  WorkflowStep,
} from "@nedia-matrix/automation-contracts";
import { z } from "zod";

import { AutomationDefinitionError, AutomationError } from "./errors.js";

export const workflowStepSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("upload"),
    targetId: z.string().min(1),
    inputKey: z.string().min(1),
  }),
  z.object({
    kind: z.literal("drop-files"),
    targetId: z.string().min(1),
    inputKey: z.string().min(1),
  }),
  z.object({ kind: z.literal("click"), targetId: z.string().min(1) }),
  z.object({
    kind: z.literal("fill"),
    targetId: z.string().min(1),
    inputKey: z.string().min(1),
  }),
  z.object({
    kind: z.literal("append-tags"),
    targetId: z.string().min(1),
    inputKey: z.string().min(1),
    bodyInputKey: z.string().min(1),
    leadingKey: z.enum(["Enter", "Space"]),
    commitKey: z.enum(["Enter", "Space"]),
    betweenText: z.string().optional(),
    typingDelayMs: z.number().int().nonnegative().optional(),
    suggestionWaitMs: z.number().int().nonnegative().optional(),
    settleWaitMs: z.number().int().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal("wait-for-state"),
    stateId: z.string().min(1),
    timeoutMs: z.number().int().positive().default(10_000),
  }),
  z.object({
    kind: z.literal("wait-for-target-count"),
    targetId: z.string().min(1),
    inputKey: z.string().min(1),
    timeoutMs: z.number().int().positive().default(10_000),
  }),
]);

const workflowInputSchema = z
  .object({
    id: z.string().min(1),
    page: z.custom<AutomationPage>(
      (value) =>
        typeof value === "object" &&
        value !== null &&
        typeof (value as AutomationPage).id === "string",
      "Workflow page must be defined with defineAutomationPage",
    ),
    startUrl: z.string().url().optional(),
    steps: z.array(workflowStepSchema).default([]),
  })
  .refine((workflow) => workflow.startUrl || workflow.steps.length > 0, {
    message: "A workflow must navigate or execute at least one step",
  });

export type AutomationWorkflowInput = z.input<typeof workflowInputSchema>;

interface InputRequirement {
  kind: "text" | "string-list";
  allowEmpty: boolean;
  path: readonly (string | number)[];
}

function targetIdFor(step: WorkflowStep): string | undefined {
  return step.kind === "wait-for-state" ? undefined : step.targetId;
}

function inputRequirements(
  steps: readonly WorkflowStep[],
): ReadonlyMap<string, InputRequirement> {
  const requirements = new Map<string, InputRequirement>();
  const issues: {
    code: "INPUT_KIND_CONFLICT";
    path: readonly (string | number)[];
    message: string;
  }[] = [];

  const add = (
    key: string,
    requirement: Omit<InputRequirement, "path">,
    path: readonly (string | number)[],
  ) => {
    const previous = requirements.get(key);
    if (previous && previous.kind !== requirement.kind) {
      issues.push({
        code: "INPUT_KIND_CONFLICT",
        path,
        message: `Workflow input ${key} is used as both ${previous.kind} and ${requirement.kind}`,
      });
      return;
    }
    requirements.set(key, {
      kind: requirement.kind,
      allowEmpty: (previous?.allowEmpty ?? true) && requirement.allowEmpty,
      path,
    });
  };

  for (const [index, step] of steps.entries()) {
    const path = ["steps", index] as const;
    switch (step.kind) {
      case "fill":
        add(step.inputKey, { kind: "text", allowEmpty: true }, [
          ...path,
          "inputKey",
        ]);
        break;
      case "upload":
      case "drop-files":
      case "wait-for-target-count":
        add(step.inputKey, { kind: "string-list", allowEmpty: false }, [
          ...path,
          "inputKey",
        ]);
        break;
      case "append-tags":
        add(step.inputKey, { kind: "string-list", allowEmpty: true }, [
          ...path,
          "inputKey",
        ]);
        add(step.bodyInputKey, { kind: "text", allowEmpty: true }, [
          ...path,
          "bodyInputKey",
        ]);
        break;
      case "click":
      case "wait-for-state":
        break;
    }
  }
  if (issues.length > 0) throw new AutomationDefinitionError(issues);
  return requirements;
}

export function defineWorkflow(
  input: AutomationWorkflowInput,
): AutomationWorkflow {
  const workflow = workflowInputSchema.parse(input);
  const issues: {
    code: "INVALID_REFERENCE";
    path: readonly (string | number)[];
    message: string;
  }[] = [];

  for (const [index, step] of workflow.steps.entries()) {
    const targetId = targetIdFor(step);
    if (targetId && !workflow.page.targets[targetId]) {
      issues.push({
        code: "INVALID_REFERENCE",
        path: ["steps", index, "targetId"],
        message: `Unknown target: ${targetId}`,
      });
    }
    if (step.kind === "wait-for-state" && !workflow.page.states[step.stateId]) {
      issues.push({
        code: "INVALID_REFERENCE",
        path: ["steps", index, "stateId"],
        message: `Unknown state: ${step.stateId}`,
      });
    }
  }
  if (issues.length > 0) throw new AutomationDefinitionError(issues);
  inputRequirements(workflow.steps);
  return workflow;
}

export function validateWorkflowInputs(
  workflow: AutomationWorkflow,
  inputs: WorkflowInputs,
): void {
  for (const [key, requirement] of inputRequirements(workflow.steps)) {
    const value = inputs[key];
    const valid =
      requirement.kind === "text"
        ? typeof value === "string"
        : Array.isArray(value) &&
          (requirement.allowEmpty || value.length > 0) &&
          value.every((item) => typeof item === "string" && item.length > 0);
    if (valid) continue;
    throw new AutomationError({
      code: "INPUT_NOT_FOUND",
      message: workflowInputErrorMessage(key, requirement),
      workflowId: workflow.id,
      pageId: workflow.page.id,
    });
  }
}

function workflowInputErrorMessage(
  key: string,
  requirement: InputRequirement,
): string {
  if (requirement.kind === "text") {
    return `Workflow input ${key} must be a string`;
  }
  if (requirement.allowEmpty) {
    return `Workflow input ${key} must be a string list`;
  }
  return `Workflow input ${key} must be a non-empty string list`;
}
