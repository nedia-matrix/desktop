import type {
  AutomationDriver,
  AutomationPage,
  DomTargetDefinition,
  ElementReference,
  TargetResolutionObserver,
} from "./index.js";

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
  onResolution?: TargetResolutionObserver,
  monotonicNow: () => number = () => Date.now(),
): Promise<readonly ElementReference[]> {
  const startedAt = monotonicNow();
  const definition = page.targets[targetId];
  if (!definition) {
    safelyObserve(onResolution, {
      targetId,
      attemptedCandidates: 0,
      matchCount: 0,
      outcome: "not_found",
      durationMs: elapsed(startedAt, monotonicNow),
    });
    return [];
  }

  let sawConditionFailure = false;
  for (const [candidateIndex, candidate] of definition.candidates.entries()) {
    const rawMatches = await driver.query(candidate);
    const matches = rawMatches.filter((element) =>
      matchesRequiredState(element, definition),
    );
    if (rawMatches.length > 0 && matches.length === 0) {
      sawConditionFailure = true;
    }
    if (matches.length > 0) {
      safelyObserve(onResolution, {
        targetId,
        selectedCandidateIndex: candidateIndex,
        selectedCandidateKind: candidate.kind,
        attemptedCandidates: candidateIndex + 1,
        matchCount: matches.length,
        elementState: matches[0]!.state,
        outcome: "resolved",
        durationMs: elapsed(startedAt, monotonicNow),
      });
      return matches;
    }
  }
  safelyObserve(onResolution, {
    targetId,
    attemptedCandidates: definition.candidates.length,
    matchCount: 0,
    outcome: sawConditionFailure ? "condition_failed" : "not_found",
    durationMs: elapsed(startedAt, monotonicNow),
  });
  return [];
}

export async function resolveTarget(
  driver: AutomationDriver,
  page: AutomationPage,
  targetId: string,
  onResolution?: TargetResolutionObserver,
  monotonicNow: () => number = () => Date.now(),
): Promise<ElementReference> {
  const startedAt = monotonicNow();
  const definition = page.targets[targetId];
  if (!definition) {
    safelyObserve(onResolution, {
      targetId,
      attemptedCandidates: 0,
      matchCount: 0,
      outcome: "not_found",
      durationMs: elapsed(startedAt, monotonicNow),
    });
    throw new AutomationError({
      code: "TARGET_NOT_FOUND",
      message: `Target ${targetId} is not defined on page ${page.id}`,
      pageId: page.id,
      targetId,
      attemptedCandidates: 0,
    });
  }

  let sawAmbiguousCandidate = false;
  let sawConditionFailure = false;
  let lastMatchCount = 0;
  for (const [candidateIndex, candidate] of definition.candidates.entries()) {
    const rawMatches = await driver.query(candidate);
    const matches = rawMatches.filter((element) =>
      matchesRequiredState(element, definition),
    );
    if (rawMatches.length > 0 && matches.length === 0) {
      sawConditionFailure = true;
    }
    lastMatchCount = matches.length;
    if (
      matches.length === 1 ||
      (definition.expectedCount === "one-or-more" && matches.length > 0)
    ) {
      safelyObserve(onResolution, {
        targetId,
        selectedCandidateIndex: candidateIndex,
        selectedCandidateKind: candidate.kind,
        attemptedCandidates: candidateIndex + 1,
        matchCount: matches.length,
        elementState: matches[0]!.state,
        outcome: "resolved",
        durationMs: elapsed(startedAt, monotonicNow),
      });
      return matches[0]!;
    }
    if (matches.length > 1) sawAmbiguousCandidate = true;
  }

  const outcome = sawAmbiguousCandidate
    ? "ambiguous"
    : sawConditionFailure
      ? "condition_failed"
      : "not_found";
  safelyObserve(onResolution, {
    targetId,
    attemptedCandidates: definition.candidates.length,
    matchCount: lastMatchCount,
    outcome,
    durationMs: elapsed(startedAt, monotonicNow),
  });

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

function elapsed(startedAt: number, monotonicNow: () => number): number {
  return Math.max(0, monotonicNow() - startedAt);
}

function safelyObserve(
  observer: TargetResolutionObserver | undefined,
  summary: Parameters<TargetResolutionObserver>[0],
): void {
  try {
    observer?.(summary);
  } catch {
    // Diagnostics must not affect target resolution.
  }
}
