import type {
  AutomationDriver,
  AutomationPage,
  ConditionDefinition,
} from "@nedia-matrix/automation-contracts";

import { AutomationError } from "./errors.js";
import { resolveTarget } from "./target-resolution.js";

export async function evaluateCondition(
  driver: AutomationDriver,
  page: AutomationPage,
  condition: ConditionDefinition,
): Promise<boolean> {
  switch (condition.kind) {
    case "url":
      return new RegExp(condition.pattern).test(await driver.currentUrl());
    case "target":
      try {
        const target = await resolveTarget(driver, page, condition.targetId);
        return target.state[condition.state];
      } catch (error) {
        if (error instanceof AutomationError) return false;
        throw error;
      }
    case "all":
      for (const child of condition.conditions) {
        if (!(await evaluateCondition(driver, page, child))) return false;
      }
      return true;
    case "any":
      for (const child of condition.conditions) {
        if (await evaluateCondition(driver, page, child)) return true;
      }
      return false;
    case "not":
      return !(await evaluateCondition(driver, page, condition.condition));
  }
}

export async function waitForCondition(
  driver: AutomationDriver,
  page: AutomationPage,
  condition: ConditionDefinition,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await evaluateCondition(driver, page, condition)) return true;
    await driver.wait(100);
  } while (Date.now() < deadline);
  return false;
}
