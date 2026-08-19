import type {
  AutomationDriver,
  AutomationPage,
  AutomationWorkflow,
  WorkflowInputs,
  WorkflowStep,
} from "@nedia-matrix/automation-contracts";

import { waitForCondition } from "./condition-evaluation.js";
import { AutomationError, type AutomationFailureDetails } from "./errors.js";
import { findTargetMatches, resolveTarget } from "./target-resolution.js";
import { validateWorkflowInputs } from "./workflow-definition.js";

function wait(
  driver: AutomationDriver,
  milliseconds: number | undefined,
): Promise<void> {
  return milliseconds && milliseconds > 0
    ? driver.wait(milliseconds)
    : Promise.resolve();
}

function stringInput(inputs: WorkflowInputs, key: string): string {
  const value = inputs[key];
  if (typeof value !== "string") {
    throw new AutomationError({
      code: "INPUT_NOT_FOUND",
      message: `Workflow input ${key} must be a string`,
    });
  }
  return value;
}

function stringListInput(
  inputs: WorkflowInputs,
  key: string,
): readonly string[] {
  const value = inputs[key];
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new AutomationError({
      code: "INPUT_NOT_FOUND",
      message: `Workflow input ${key} must be a string list`,
    });
  }
  return value;
}

async function executeAppendTags(
  page: AutomationPage,
  step: Extract<WorkflowStep, { kind: "append-tags" }>,
  driver: AutomationDriver,
  inputs: WorkflowInputs,
): Promise<void> {
  const tags = stringListInput(inputs, step.inputKey);
  const body = stringInput(inputs, step.bodyInputKey);
  if (tags.length === 0) return;

  const target = await resolveTarget(driver, page, step.targetId);
  if (body.length > 0) await driver.pressKey(target, step.leadingKey);
  for (const [index, tag] of tags.entries()) {
    await driver.typeText(target, `#${tag}`, step.typingDelayMs);
    await wait(driver, step.suggestionWaitMs);
    await driver.pressKey(target, step.commitKey);
    await wait(driver, step.settleWaitMs);
    if (step.betweenText && index < tags.length - 1) {
      await driver.typeText(target, step.betweenText, step.typingDelayMs);
    }
  }
}

async function executeStep(
  page: AutomationPage,
  step: WorkflowStep,
  driver: AutomationDriver,
  inputs: WorkflowInputs,
): Promise<void> {
  switch (step.kind) {
    case "click":
      await driver.click(await resolveTarget(driver, page, step.targetId));
      return;
    case "fill":
      await driver.fill(
        await resolveTarget(driver, page, step.targetId),
        stringInput(inputs, step.inputKey),
      );
      return;
    case "upload":
      await driver.uploadFiles(
        await resolveTarget(driver, page, step.targetId),
        stringListInput(inputs, step.inputKey),
      );
      return;
    case "drop-files":
      await driver.dropFiles(
        await resolveTarget(driver, page, step.targetId),
        stringListInput(inputs, step.inputKey),
      );
      return;
    case "append-tags":
      await executeAppendTags(page, step, driver, inputs);
      return;
    case "wait-for-state": {
      const condition = page.states[step.stateId];
      if (
        !condition ||
        !(await waitForCondition(driver, page, condition, step.timeoutMs))
      ) {
        throw new AutomationError({
          code: "STATE_NOT_FOUND",
          message: condition
            ? `Timed out waiting for state ${step.stateId}`
            : `State ${step.stateId} is not defined on page ${page.id}`,
          pageId: page.id,
          stateId: step.stateId,
        });
      }
      return;
    }
    case "wait-for-target-count": {
      const expectedItems = stringListInput(inputs, step.inputKey);
      const deadline = Date.now() + step.timeoutMs;
      let count = 0;
      do {
        count = (await findTargetMatches(driver, page, step.targetId)).length;
        if (count >= expectedItems.length) return;
        await wait(driver, 100);
      } while (Date.now() < deadline);
      throw new AutomationError({
        code: "STATE_NOT_FOUND",
        message: `Timed out waiting for ${expectedItems.length} matches of ${step.targetId}; found ${count}`,
        pageId: page.id,
        targetId: step.targetId,
      });
    }
  }
}

interface ActiveAction {
  index?: number;
  kind: string;
  targetId?: string;
  stateId?: string;
}

function activeActionFor(index: number, step: WorkflowStep): ActiveAction {
  const action: ActiveAction = { index, kind: step.kind };
  if (step.kind === "wait-for-state") {
    action.stateId = step.stateId;
  } else {
    action.targetId = step.targetId;
  }
  return action;
}

function unexpectedFailureMessage(
  workflow: AutomationWorkflow,
  activeAction: ActiveAction | undefined,
  originalMessage: string,
): string {
  const actionKind = activeAction?.kind ?? "validation";
  let stepContext = "";
  if (activeAction?.index !== undefined) {
    stepContext = ` step ${activeAction.index + 1}`;
  }
  return `Workflow ${workflow.id}${stepContext} (${actionKind}) failed: ${originalMessage}`;
}

function failureDetails(
  workflow: AutomationWorkflow,
  activeAction: ActiveAction | undefined,
  error: unknown,
): AutomationFailureDetails {
  let details: AutomationFailureDetails;
  if (error instanceof AutomationError) {
    details = { ...error.details, message: error.message };
  } else {
    const originalMessage =
      error instanceof Error ? error.message : "Workflow action failed";
    details = {
      code: "ACTION_FAILED",
      message: unexpectedFailureMessage(
        workflow,
        activeAction,
        originalMessage,
      ),
    };
  }

  details.workflowId = workflow.id;
  details.pageId = workflow.page.id;
  if (activeAction?.index !== undefined) {
    details.stepIndex = activeAction.index;
  }
  if (activeAction?.targetId) details.targetId = activeAction.targetId;
  if (activeAction?.stateId) details.stateId = activeAction.stateId;
  return details;
}

async function createWorkflowFailure(
  workflow: AutomationWorkflow,
  activeAction: ActiveAction | undefined,
  driver: AutomationDriver,
  error: unknown,
): Promise<AutomationError> {
  const failure = new AutomationError(
    failureDetails(workflow, activeAction, error),
  );
  try {
    failure.details.evidence = await driver.captureEvidence(failure.message);
  } catch {
    // Evidence collection must not hide the original automation failure.
  }
  return failure;
}

export async function executeWorkflow(
  workflow: AutomationWorkflow,
  driver: AutomationDriver,
  inputs: WorkflowInputs,
): Promise<void> {
  let activeAction: ActiveAction | undefined;
  try {
    validateWorkflowInputs(workflow, inputs);
    if (workflow.startUrl) {
      activeAction = { kind: "navigate" };
      await driver.navigate(workflow.startUrl);
    }
    for (const [index, step] of workflow.steps.entries()) {
      activeAction = activeActionFor(index, step);
      await executeStep(workflow.page, step, driver, inputs);
    }
  } catch (error) {
    const failure = await createWorkflowFailure(
      workflow,
      activeAction,
      driver,
      error,
    );
    throw failure;
  }
}
