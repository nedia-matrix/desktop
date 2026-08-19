import type {
  AutomationDriver,
  AutomationPage,
  DomTargetDefinition,
  ElementReference,
} from "@nedia-matrix/automation-contracts";

import { AutomationError } from "./errors.js";

function matchesRequiredState(
  element: ElementReference,
  definition: DomTargetDefinition,
): boolean {
  return definition.conditions.every((condition) => element.state[condition]);
}

export async function findTargetMatches(
  driver: AutomationDriver,
  page: AutomationPage,
  targetId: string,
): Promise<readonly ElementReference[]> {
  const definition = page.targets[targetId];
  if (!definition) return [];

  for (const candidate of definition.candidates) {
    const matches = (await driver.query(candidate)).filter((element) =>
      matchesRequiredState(element, definition),
    );
    if (matches.length > 0) return matches;
  }
  return [];
}

export async function resolveTarget(
  driver: AutomationDriver,
  page: AutomationPage,
  targetId: string,
): Promise<ElementReference> {
  const definition = page.targets[targetId];
  if (!definition) {
    throw new AutomationError({
      code: "TARGET_NOT_FOUND",
      message: `Target ${targetId} is not defined on page ${page.id}`,
      pageId: page.id,
      targetId,
      attemptedCandidates: 0,
    });
  }

  let sawAmbiguousCandidate = false;
  for (const candidate of definition.candidates) {
    const matches = (await driver.query(candidate)).filter((element) =>
      matchesRequiredState(element, definition),
    );
    if (
      matches.length === 1 ||
      (definition.expectedCount === "one-or-more" && matches.length > 0)
    ) {
      return matches[0]!;
    }
    if (matches.length > 1) sawAmbiguousCandidate = true;
  }

  throw new AutomationError({
    code: sawAmbiguousCandidate ? "TARGET_AMBIGUOUS" : "TARGET_NOT_FOUND",
    message: sawAmbiguousCandidate
      ? `Every matching locator for ${targetId} was ambiguous`
      : `No locator matched target ${targetId}`,
    pageId: page.id,
    targetId,
    attemptedCandidates: definition.candidates.length,
  });
}
