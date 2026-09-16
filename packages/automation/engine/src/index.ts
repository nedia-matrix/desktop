export {
  AutomationDefinitionError,
  AutomationError,
  type AutomationDefinitionIssue,
  type AutomationFailureDetails,
} from "./errors.js";
export {
  automationPageSchema,
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
  workflowStepSchema,
  type AutomationWorkflowInput,
} from "./workflow-definition.js";
export { executeWorkflow } from "./workflow-execution.js";
export * from "./automation-trace.js";
export * from "./driver.js";
export * from "./session.js";
export * from "./workflow.js";
