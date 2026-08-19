export {
  AutomationDefinitionError,
  AutomationError,
  type AutomationDefinitionIssue,
  type AutomationFailureDetails,
} from "./errors.js";
export {
  defineAutomationPage,
  type AutomationPageInput,
} from "./page-definition.js";
export {
  defineSessionDetectionPlan,
  detectPlatformSession,
  type SessionDetectionPlanInput,
} from "./session-detection.js";
export {
  defineWorkflow,
  type AutomationWorkflowInput,
} from "./workflow-definition.js";
export { executeWorkflow } from "./workflow-execution.js";
export type {
  WorkflowInput,
  WorkflowInputs,
} from "@nedia-matrix/automation-contracts";
