export type AutomationNotice =
  | { kind: "account.synced"; accountId: string }
  | {
      kind: "publish.awaiting_confirmation";
      accountId: string;
      publicationId: string;
    };

export interface AutomationNoticeSink {
  show(notice: AutomationNotice): void;
}

// Presentation failure must never change a completed business operation.
export function showAutomationNotice(
  sink: AutomationNoticeSink | undefined,
  notice: AutomationNotice,
): void {
  try {
    sink?.show(notice);
  } catch (error) {
    console.error("Failed to show automation notice", error);
  }
}

export const automationNoticeMessages = {
  "account.synced": {
    title: "资料同步完成",
    body: "账号资料已同步。你可以关闭浏览器窗口，也可以保留窗口继续操作。",
  },
  "publish.awaiting_confirmation": {
    title: "自动填充完毕",
    body: "你可以在浏览器中自行检查、修改内容，最后必须亲自点击「发布」按钮。请保留浏览器窗口，以便获取发布结果。",
  },
} as const;
