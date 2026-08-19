import type { AutomationWorkflow } from "@nedia-matrix/automation-contracts";
import { z } from "zod";

export const publishContentFormSchema = z.enum([
  "video",
  "imageText",
  "longText",
]);
export type PublishContentForm = z.infer<typeof publishContentFormSchema>;

export const publishConstraintsSchema = z.object({
  titleMaxLength: z.number().int().positive().optional(),
  bodyMaxLength: z.number().int().positive().optional(),
  mediaMaxCount: z.number().int().positive().optional(),
});
export type PublishConstraints = z.infer<typeof publishConstraintsSchema>;

export const publishTagPolicySchema = z.object({
  placement: z.enum(["inline", "new-lines"]),
  maxCount: z.number().int().positive().optional(),
});
export type PublishTagPolicy = z.infer<typeof publishTagPolicySchema>;

export interface PlatformPublishAutomation {
  readonly prepare: AutomationWorkflow;
  readonly submit: AutomationWorkflow;
}

export interface PlatformPublishFormCapability {
  readonly constraints: PublishConstraints;
  readonly tagPolicy?: PublishTagPolicy;
  readonly submissionModes: readonly ("automatic" | "manual_confirmation")[];
  readonly descriptionComposition?: {
    readonly parts: readonly ("title" | "body")[];
    readonly separator: string;
  };
  readonly automation: PlatformPublishAutomation;
}
