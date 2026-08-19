import type { AutomationKey, LocatorCandidate } from "./driver.js";

export type TargetId = string;
export type StateId = string;
export type ElementCondition = "attached" | "visible" | "enabled" | "editable";

export interface DomTargetDefinition {
  readonly candidates: readonly LocatorCandidate[];
  readonly expectedCount: "one" | "one-or-more";
  readonly conditions: readonly ElementCondition[];
}

export type ConditionDefinition =
  | { readonly kind: "url"; readonly pattern: string }
  | {
      readonly kind: "target";
      readonly targetId: TargetId;
      readonly state: ElementCondition;
    }
  | {
      readonly kind: "all";
      readonly conditions: readonly ConditionDefinition[];
    }
  | {
      readonly kind: "any";
      readonly conditions: readonly ConditionDefinition[];
    }
  | { readonly kind: "not"; readonly condition: ConditionDefinition };

export interface AutomationPage {
  readonly id: string;
  readonly states: Readonly<Record<StateId, ConditionDefinition>>;
  readonly targets: Readonly<Record<TargetId, DomTargetDefinition>>;
}

export type WorkflowStep =
  | {
      readonly kind: "upload";
      readonly targetId: TargetId;
      readonly inputKey: string;
    }
  | {
      readonly kind: "drop-files";
      readonly targetId: TargetId;
      readonly inputKey: string;
    }
  | { readonly kind: "click"; readonly targetId: TargetId }
  | {
      readonly kind: "fill";
      readonly targetId: TargetId;
      readonly inputKey: string;
    }
  | {
      readonly kind: "append-tags";
      readonly targetId: TargetId;
      readonly inputKey: string;
      readonly bodyInputKey: string;
      readonly leadingKey: AutomationKey;
      readonly commitKey: AutomationKey;
      readonly betweenText?: string;
      readonly typingDelayMs?: number;
      readonly suggestionWaitMs?: number;
      readonly settleWaitMs?: number;
    }
  | {
      readonly kind: "wait-for-state";
      readonly stateId: StateId;
      readonly timeoutMs: number;
    }
  | {
      readonly kind: "wait-for-target-count";
      readonly targetId: TargetId;
      readonly inputKey: string;
      readonly timeoutMs: number;
    };

export interface AutomationWorkflow {
  readonly id: string;
  readonly page: AutomationPage;
  readonly startUrl?: string;
  readonly steps: readonly WorkflowStep[];
}

export type WorkflowInput = string | readonly string[];
export type WorkflowInputs = Readonly<Record<string, WorkflowInput>>;
