import type {
  PlatformAccountInfoKey,
  PlatformAccountSummary,
  PlatformLoginEntrySummary,
} from "@nedia-matrix/ipc-contracts";

import type { AppContext } from "../app-context.js";
import type { PageInstance } from "../router.js";
import {
  accountLabel,
  accountStatus,
  errorMessage,
  formatTime,
  platformFor,
  requireElement,
} from "../shared.js";

export function createAccountsPage(context: AppContext): PageInstance {
  let mounted = false;
  let root: HTMLElement | undefined;
  let stopAccountUpdates: (() => void) | undefined;

  async function loadAccounts(): Promise<void> {
    const accounts = await context.refreshAccounts();
    if (mounted) renderAccounts(accounts);
  }

  async function loginAccount(
    account: PlatformAccountSummary,
    loginEntry: PlatformLoginEntrySummary,
  ): Promise<void> {
    await window.matrix.openPlatformLogin({
      accountId: account.id,
      loginEntryId: loginEntry.id,
    });
    context.setStatus(
      `已打开账号浏览器，请完成“${loginEntry.displayName}”；登录成功后将自动识别账号`,
    );
  }

  function renderPlatforms(): void {
    const platformList = requireElement<HTMLElement>(root!, "#platform-list");
    platformList.replaceChildren();
    for (const platform of context.platforms) {
      for (const loginEntry of platform.loginEntries) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = platform.displayName;
        if (platform.loginEntries.length > 1) {
          button.textContent += ` · ${loginEntry.displayName}`;
        }
        button.addEventListener("click", async () => {
          button.disabled = true;
          context.setStatus(
            `正在创建 ${platform.displayName} 独立 Session…`,
            "busy",
          );
          let account: PlatformAccountSummary | undefined;
          try {
            account = await window.matrix.createPlatformAccount({
              platformId: platform.id,
            });
            await loadAccounts();
            await loginAccount(account, loginEntry);
          } catch (error) {
            if (account) await loadAccounts();
            context.setStatus(errorMessage(error, "创建账号失败"), "error");
          } finally {
            button.disabled = false;
          }
        });
        platformList.append(button);
      }
    }
  }

  function renderAccounts(accounts: readonly PlatformAccountSummary[]): void {
    const accountList = requireElement<HTMLElement>(root!, "#account-list");
    accountList.replaceChildren();
    if (accounts.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "尚未连接平台账号，请从上方选择平台开始。";
      accountList.append(empty);
      return;
    }

    for (const account of accounts) {
      accountList.append(createAccountCard(account));
    }
  }

  function createAccountCard(account: PlatformAccountSummary): HTMLElement {
    const article = document.createElement("article");
    article.className = "account-card";

    const header = document.createElement("header");
    const accountName = account.nickname ?? account.displayName;
    const identity = document.createElement("div");
    identity.className = "account-identity";
    const identityText = document.createElement("div");
    const heading = document.createElement("h3");
    heading.textContent = accountName;
    const platformName =
      platformFor(context.platforms, account.platformId)?.displayName ??
      account.platformId;
    const metadata = document.createElement("p");
    metadata.textContent = `${platformName} · ${accountStatus(account)}`;
    identityText.append(heading, metadata);
    identity.append(
      createAccountAvatar(account.avatarUrl, accountName),
      identityText,
    );

    const details = document.createElement("dl");
    details.className = "account-details";
    appendDetail(
      details,
      "平台账号 ID",
      account.externalAccountId ?? "等待识别",
    );
    for (const information of account.accountInfo ?? []) {
      appendDetail(
        details,
        accountInfoLabel(information.key, account.platformId),
        formatAccountInfoValue(information.value),
      );
    }
    appendDetail(
      details,
      "最近同步",
      account.lastVerifiedAt ? formatTime(account.lastVerifiedAt) : "-",
    );

    const actions = document.createElement("div");
    actions.className = "button-row account-actions";
    actions.append(
      actionButton("打开平台", async () => {
        context.setStatus(
          `正在打开 ${accountLabel(account, context.platforms)}…`,
          "busy",
        );
        await window.matrix.openPlatformAccount({ accountId: account.id });
        context.setStatus(
          `已打开 ${accountLabel(account, context.platforms)}，账号信息将自动更新`,
        );
      }),
    );

    actions.append(
      actionButton(
        "删除",
        async () => {
          if (
            !globalThis.confirm(
              `删除“${accountLabel(account, context.platforms)}”及其本地登录数据？`,
            )
          ) {
            return;
          }
          context.setStatus("正在删除账号和本地 Session…", "busy");
          await window.matrix.removePlatformAccount({ accountId: account.id });
          await loadAccounts();
          context.setStatus("账号和本地 Session 已删除");
        },
        "secondary-button danger-button",
      ),
    );

    header.append(identity, actions);
    article.append(header, details);
    return article;
  }

  function actionButton(
    label: string,
    action: () => void | Promise<void>,
    className = "",
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await action();
      } catch (error) {
        context.setStatus(errorMessage(error, `${label}失败`), "error");
      } finally {
        if (button.isConnected) button.disabled = false;
      }
    });
    return button;
  }

  return {
    async mount(container) {
      mounted = true;
      root = document.createElement("div");
      root.className = "page-stack";
      root.innerHTML = `
        <section class="panel connect-panel" aria-labelledby="connect-title">
          <div class="section-heading">
            <div>
              <p class="section-label">添加账号</p>
              <h2 id="connect-title">连接新的平台账号</h2>
            </div>
            <p>每个账号使用独立的持久化浏览器 Session。</p>
          </div>
          <div id="platform-list" class="platform-buttons" aria-live="polite"></div>
        </section>
        <section class="panel" aria-labelledby="accounts-title">
          <div class="section-heading">
            <div>
              <p class="section-label">本地账号</p>
              <h2 id="accounts-title">已保存的独立 Session</h2>
            </div>
            <p>删除账号会同时清理对应的本地登录数据。</p>
          </div>
          <div id="account-list" class="card-grid" aria-live="polite">
            <p class="empty-state">正在加载账号…</p>
          </div>
        </section>`;
      container.append(root);
      renderPlatforms();
      stopAccountUpdates = context.onAccountUpdate((accounts) => {
        if (mounted) renderAccounts(accounts);
      });
      await loadAccounts();
    },
    unmount() {
      mounted = false;
      stopAccountUpdates?.();
      stopAccountUpdates = undefined;
      root = undefined;
    },
  };
}

function appendDetail(list: HTMLDListElement, label: string, value: string) {
  const term = document.createElement("dt");
  term.textContent = label;
  const description = document.createElement("dd");
  description.textContent = value;
  list.append(term, description);
}

function createAccountAvatar(
  avatarUrl: string | null | undefined,
  accountName: string,
): HTMLElement {
  const fallback = document.createElement("span");
  fallback.className = "account-avatar account-avatar-fallback";
  fallback.textContent = Array.from(accountName.trim())[0] ?? "账";
  fallback.ariaHidden = "true";

  if (!avatarUrl?.trim()) return fallback;

  const image = document.createElement("img");
  image.className = "account-avatar";
  image.src = avatarUrl.trim();
  image.alt = "";
  image.loading = "lazy";
  image.decoding = "async";
  image.referrerPolicy = "no-referrer";
  image.addEventListener("error", () => image.replaceWith(fallback), {
    once: true,
  });
  return image;
}

function accountInfoLabel(
  key: PlatformAccountInfoKey,
  platformId: string,
): string {
  switch (key) {
    case "desc":
      return "账号简介";
    case "follower_count":
      return "粉丝数";
    case "content_count":
      return platformId === "xiaohongshu"
        ? "笔记数"
        : platformId === "douyin"
          ? "作品数"
          : "内容数";
    case "like_count":
      return "获赞数";
  }
}

function formatAccountInfoValue(value: string | number): string {
  return typeof value === "number"
    ? new Intl.NumberFormat("zh-CN").format(value)
    : value;
}
