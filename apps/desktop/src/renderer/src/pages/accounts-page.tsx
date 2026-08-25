import type {
  PlatformAccountInfoKey,
  PlatformAccountSummary,
  PlatformLoginEntrySummary,
} from "@nedia-matrix/ipc-contracts";
import { useEffect, useState } from "preact/hooks";

import type { AppContext } from "../app-context.js";
import { Icon } from "../components/icons.js";
import { PlatformIcon } from "../components/platform-icon.js";
import {
  accountLabel,
  accountStatus,
  errorMessage,
  formatTime,
  platformFor,
} from "../shared.js";

export function AccountsPage({ context }: { context: AppContext }) {
  const [accounts, setAccounts] = useState(context.accounts);
  const [loading, setLoading] = useState(true);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [busyKey, setBusyKey] = useState<string>();

  const loadAccounts = async () => {
    const refreshed = await context.refreshAccounts();
    setAccounts(refreshed);
  };

  useEffect(() => {
    let active = true;
    void context
      .refreshAccounts()
      .then((refreshed) => {
        if (active) setAccounts(refreshed);
      })
      .catch((error) => {
        context.setStatus(errorMessage(error, "账号加载失败"), "error");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const stopUpdates = context.onAccountUpdate((refreshed) => {
      if (active) setAccounts(refreshed);
    });
    return () => {
      active = false;
      stopUpdates();
    };
  }, [context]);

  const createAccount = async (
    platformId: string,
    platformName: string,
    loginEntry: PlatformLoginEntrySummary,
  ) => {
    const operationKey = `create:${platformId}:${loginEntry.id}`;
    setBusyKey(operationKey);
    context.setStatus(`正在创建 ${platformName} 独立 Session…`, "busy");
    let account: PlatformAccountSummary | undefined;
    try {
      account = await window.matrix.createPlatformAccount({ platformId });
      await loadAccounts();
      await window.matrix.openPlatformLogin({
        accountId: account.id,
        loginEntryId: loginEntry.id,
      });
      setShowAddAccount(false);
      context.setStatus(
        `已打开 ${platformName} 登录窗口，登录成功后将自动识别账号`,
      );
    } catch (error) {
      if (account) await loadAccounts();
      context.setStatus(errorMessage(error, "创建账号失败"), "error");
    } finally {
      setBusyKey(undefined);
    }
  };

  const runAccountAction = async (
    account: PlatformAccountSummary,
    action: "open" | "refresh" | "delete",
  ) => {
    setBusyKey(`${action}:${account.id}`);
    try {
      if (action === "open") {
        context.setStatus(
          `正在打开 ${accountLabel(account, context.platforms)}…`,
          "busy",
        );
        await window.matrix.openPlatformAccount({ accountId: account.id });
        context.setStatus("平台窗口已打开，账号信息将在识别后更新");
      } else if (action === "refresh") {
        context.setStatus("正在从平台刷新账号信息…", "busy");
        await window.matrix.refreshPlatformAccount({ accountId: account.id });
        await loadAccounts();
        context.setStatus("账号信息已刷新");
      } else {
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
      }
    } catch (error) {
      const fallback = action === "delete" ? "删除账号失败" : "账号操作失败";
      context.setStatus(errorMessage(error, fallback), "error");
    } finally {
      setBusyKey(undefined);
    }
  };

  return (
    <div class="page-stack">
      <section class="page-toolbar" aria-label="账号操作">
        <div class="toolbar-summary">
          <strong>{accounts.length}</strong>
          <span>个本地账号</span>
          <span class="toolbar-separator" aria-hidden="true" />
          <span>
            {accounts.filter(({ status }) => status === "authenticated").length}{" "}
            个已连接
          </span>
        </div>
        <div class="toolbar-actions">
          <button
            class="secondary-button compact-button"
            type="button"
            disabled={busyKey === "refresh-all"}
            onClick={async () => {
              setBusyKey("refresh-all");
              context.setStatus("正在刷新账号列表…", "busy");
              try {
                await loadAccounts();
                context.setStatus("账号列表已刷新");
              } catch (error) {
                context.setStatus(errorMessage(error, "刷新失败"), "error");
              } finally {
                setBusyKey(undefined);
              }
            }}
          >
            <Icon name="refresh" size={16} />
            刷新
          </button>
          <button
            class="compact-button"
            type="button"
            onClick={() => setShowAddAccount((visible) => !visible)}
          >
            <Icon name="add" size={16} />
            添加账号
          </button>
        </div>
      </section>

      {showAddAccount && (
        <section class="add-account-panel" aria-labelledby="add-account-title">
          <div>
            <h2 id="add-account-title">选择要连接的平台</h2>
            <p>每个账号使用独立的持久化浏览器 Session。</p>
          </div>
          <div class="platform-grid">
            {context.platforms.flatMap((platform) =>
              platform.loginEntries.map((entry) => {
                const operationKey = `create:${platform.id}:${entry.id}`;
                return (
                  <button
                    class="platform-option"
                    type="button"
                    key={operationKey}
                    disabled={busyKey === operationKey}
                    onClick={() =>
                      void createAccount(
                        platform.id,
                        platform.displayName,
                        entry,
                      )
                    }
                  >
                    <PlatformIcon
                      platformId={platform.id}
                      platformName={platform.displayName}
                    />
                    <span>
                      <strong>{platform.displayName}</strong>
                      <small>
                        {platform.loginEntries.length > 1
                          ? entry.displayName
                          : "连接新账号"}
                      </small>
                    </span>
                    <Icon name="arrow-up-right" size={16} />
                  </button>
                );
              }),
            )}
          </div>
        </section>
      )}

      <section class="data-surface" aria-labelledby="account-list-title">
        <header class="surface-header">
          <div>
            <h2 id="account-list-title">账号列表</h2>
            <p>平台资料、连接状态和内容数据会保存在本机。</p>
          </div>
        </header>
        <div class="account-list-heading" aria-hidden="true">
          <span>账号</span>
          <span>平台</span>
          <span>数据概览</span>
          <span>最近同步</span>
          <span>操作</span>
        </div>
        <div class="account-list" aria-live="polite">
          {loading ? (
            <EmptyState title="正在加载账号…" />
          ) : accounts.length === 0 ? (
            <EmptyState
              title="还没有平台账号"
              detail="点击“添加账号”连接第一个内容平台。"
            />
          ) : (
            accounts.map((account) => (
              <AccountRow
                account={account}
                context={context}
                busyKey={busyKey}
                key={account.id}
                onAction={runAccountAction}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function AccountRow({
  account,
  context,
  busyKey,
  onAction,
}: {
  account: PlatformAccountSummary;
  context: AppContext;
  busyKey: string | undefined;
  onAction(
    account: PlatformAccountSummary,
    action: "open" | "refresh" | "delete",
  ): Promise<void>;
}) {
  const platformName =
    platformFor(context.platforms, account.platformId)?.displayName ??
    account.platformId;
  const accountName = account.nickname ?? account.displayName;
  const followerCount = accountInformation(account, "follower_count");
  const contentCount = accountInformation(account, "content_count");
  const likeCount = accountInformation(account, "like_count");
  const actionBusy = busyKey?.endsWith(account.id) ?? false;

  return (
    <article class="account-row">
      <div class="account-identity">
        <AccountAvatar account={account} accountName={accountName} />
        <span class="account-name">
          <strong>{accountName}</strong>
          <small title={account.externalAccountId ?? undefined}>
            {account.externalAccountId ?? "等待识别平台账号 ID"}
          </small>
        </span>
      </div>
      <div class="platform-cell">
        <PlatformIcon
          compact
          platformId={account.platformId}
          platformName={platformName}
        />
        <span>{platformName}</span>
      </div>
      <div class="account-metrics">
        <Metric label="粉丝" value={followerCount} />
        <Metric label="内容" value={contentCount} />
        <Metric label="获赞" value={likeCount} />
      </div>
      <div class="account-sync">
        <span class={`status-badge account-${account.status}`}>
          <span class="badge-dot" aria-hidden="true" />
          {accountStatus(account)}
        </span>
        <small>
          {account.lastVerifiedAt
            ? formatTime(account.lastVerifiedAt)
            : "尚未同步"}
        </small>
      </div>
      <div class="row-actions">
        <button
          class="secondary-button small-button"
          type="button"
          disabled={actionBusy}
          onClick={() => void onAction(account, "open")}
        >
          打开平台
        </button>
        <details class="action-menu">
          <summary class="icon-button" aria-label="更多账号操作">
            <Icon name="more" />
          </summary>
          <div class="action-menu-popover">
            <button
              type="button"
              disabled={actionBusy}
              onClick={() => void onAction(account, "refresh")}
            >
              <Icon name="refresh" size={15} />
              刷新账号资料
            </button>
            <button
              class="danger-menu-item"
              type="button"
              disabled={actionBusy}
              onClick={() => void onAction(account, "delete")}
            >
              <Icon name="delete" size={15} />
              删除账号
            </button>
          </div>
        </details>
      </div>
    </article>
  );
}

function AccountAvatar({
  account,
  accountName,
}: {
  account: PlatformAccountSummary;
  accountName: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  if (!account.avatarUrl?.trim() || imageFailed) {
    return (
      <span class="account-avatar account-avatar-fallback" aria-hidden="true">
        {Array.from(accountName.trim())[0] ?? "账"}
      </span>
    );
  }
  return (
    <img
      class="account-avatar"
      src={account.avatarUrl.trim()}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setImageFailed(true)}
    />
  );
}

function Metric({ label, value }: { label: string; value?: string | number }) {
  return (
    <span>
      <strong>
        {value === undefined ? "—" : formatAccountInfoValue(value)}
      </strong>
      <small>{label}</small>
    </span>
  );
}

function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div class="empty-state">
      <strong>{title}</strong>
      {detail && <p>{detail}</p>}
    </div>
  );
}

function accountInformation(
  account: PlatformAccountSummary,
  key: PlatformAccountInfoKey,
): string | number | undefined {
  return account.accountInfo?.find((item) => item.key === key)?.value;
}

function formatAccountInfoValue(value: string | number): string {
  return typeof value === "number"
    ? new Intl.NumberFormat("zh-CN", { notation: "compact" }).format(value)
    : value;
}
