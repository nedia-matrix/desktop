import type {
  PlatformAccountSummary,
  PlatformSummary,
  PublicationStatus,
} from "@nedia-matrix/ipc-contracts";

export const publicationStateLabels: Readonly<
  Record<PublicationStatus, string>
> = {
  draft: "草稿",
  validated: "已校验",
  scheduled: "已计划",
  preparing: "准备中",
  awaiting_confirmation: "等待手动发布",
  submitting: "提交中",
  verifying: "确认中",
  published: "发布成功",
  uncertain: "结果待核实",
  failed: "失败",
  retrying: "重试中",
  rejected: "已拒绝",
  cancelled: "已取消",
};

export function requireElement<T extends Element>(
  root: ParentNode,
  selector: string,
): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Desktop page is missing ${selector}`);
  return element;
}

export function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString("zh-CN");
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function platformFor(
  platforms: readonly PlatformSummary[],
  platformId: string,
): PlatformSummary | undefined {
  return platforms.find((platform) => platform.id === platformId);
}

export function accountLabel(
  account: PlatformAccountSummary,
  platforms: readonly PlatformSummary[],
): string {
  const platform = platformFor(platforms, account.platformId);
  return `${account.nickname ?? account.displayName} · ${platform?.displayName ?? account.platformId}`;
}

export function accountStatus(account: PlatformAccountSummary): string {
  switch (account.status) {
    case "authenticated":
      return "已连接";
    case "login_required":
      return "需要登录";
    case "unknown":
      return "待确认";
  }
}
