import type { EvidenceReference } from "@nedia-matrix/automation-contracts";

export interface AutomationFailureDetails {
  code:
    | "PAGE_NOT_FOUND"
    | "STATE_NOT_FOUND"
    | "TARGET_NOT_FOUND"
    | "TARGET_AMBIGUOUS"
    | "TARGET_CONDITION_FAILED"
    | "INPUT_NOT_FOUND"
    | "ACTION_FAILED";
  message: string;
  workflowId?: string;
  pageId?: string;
  stepIndex?: number;
  stateId?: string;
  targetId?: string;
  attemptedCandidates?: number;
  evidence?: EvidenceReference;
}

export interface AutomationDefinitionIssue {
  code: "INVALID_REFERENCE" | "INVALID_PATTERN" | "INPUT_KIND_CONFLICT";
  path: readonly (string | number)[];
  message: string;
}

export class AutomationDefinitionError extends TypeError {
  constructor(readonly issues: readonly AutomationDefinitionIssue[]) {
    super(
      issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("\n"),
    );
    this.name = "AutomationDefinitionError";
  }
}

export class AutomationError extends Error {
  constructor(readonly details: AutomationFailureDetails) {
    super(details.message);
    this.name = "AutomationError";
  }
}
