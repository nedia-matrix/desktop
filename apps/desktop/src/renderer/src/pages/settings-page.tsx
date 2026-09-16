import type { AppContext } from "../app-context.js";
import { Icon } from "../components/icons.js";
import type { ResolvedTheme, ThemePreference } from "../theme.js";
import { useState } from "preact/hooks";

export interface RuntimeSummary {
  version: string | null;
  status: "loading" | "running" | "stopped" | "unknown";
  host: "127.0.0.1" | null;
  port: number | null;
}

export interface UpdateCheckFeedback {
  message: string;
  error: boolean;
}

export function SettingsPage({
  context,
  themePreference = "system",
  resolvedTheme = "light",
  onThemePreferenceChange = () => undefined,
  runtime = { version: null, status: "loading", host: null, port: null },
  runtimeActionPending = false,
  runtimeError = null,
  onRuntimeRunningChange = () => undefined,
  updateCheckPending = false,
  updateCheckCompleted = false,
  updateCheckFeedback = null,
  availableUpdateVersion = null,
  currentApplicationVersion = null,
  updateDownloadPending = false,
  onCheckForApplicationUpdate = () => undefined,
  onOpenApplicationUpdateDownload = () => undefined,
}: {
  context: AppContext;
  themePreference?: ThemePreference;
  resolvedTheme?: ResolvedTheme;
  onThemePreferenceChange?: (preference: ThemePreference) => void;
  runtime?: RuntimeSummary;
  runtimeActionPending?: boolean;
  runtimeError?: string | null;
  onRuntimeRunningChange?: (running: boolean) => void | Promise<void>;
  updateCheckPending?: boolean;
  updateCheckCompleted?: boolean;
  updateCheckFeedback?: UpdateCheckFeedback | null;
  availableUpdateVersion?: string | null;
  currentApplicationVersion?: string | null;
  updateDownloadPending?: boolean;
  onCheckForApplicationUpdate?: () => void | Promise<void>;
  onOpenApplicationUpdateDownload?: (version: string) => void | Promise<void>;
}) {
  return (
    <div class="settings-layout">
      <ApplicationUpdateSettings
        currentVersion={currentApplicationVersion ?? runtime.version}
        checkPending={updateCheckPending}
        checkCompleted={updateCheckCompleted}
        feedback={updateCheckFeedback}
        availableVersion={availableUpdateVersion}
        downloadPending={updateDownloadPending}
        onCheck={onCheckForApplicationUpdate}
        onDownload={onOpenApplicationUpdateDownload}
      />

      <section class="settings-surface" aria-labelledby="appearance-title">
        <header class="settings-section-header">
          <div>
            <h2 id="appearance-title">外观</h2>
            <p>选择 Nedia Matrix 在这台设备上的显示方式。</p>
          </div>
        </header>
        <div class="theme-options" role="radiogroup" aria-label="应用主题">
          <ThemeOption
            preference="system"
            label="跟随系统"
            detail={`当前使用${resolvedTheme === "dark" ? "深色" : "浅色"}外观`}
            icon="system"
            selected={themePreference === "system"}
            onSelect={onThemePreferenceChange}
          />
          <ThemeOption
            preference="light"
            label="浅色"
            detail="始终使用浅色外观"
            icon="light"
            selected={themePreference === "light"}
            onSelect={onThemePreferenceChange}
          />
          <ThemeOption
            preference="dark"
            label="深色"
            detail="始终使用深色外观"
            icon="dark"
            selected={themePreference === "dark"}
            onSelect={onThemePreferenceChange}
          />
        </div>
      </section>

      <RuntimeSettings
        runtime={runtime}
        actionPending={runtimeActionPending}
        error={runtimeError}
        onRunningChange={onRuntimeRunningChange}
      />

      <AutomationDiagnosticSettings context={context} />
    </div>
  );
}

function AutomationDiagnosticSettings({ context }: { context: AppContext }) {
  const [opening, setOpening] = useState(false);

  return (
    <section class="settings-surface" aria-labelledby="diagnostics-title">
      <header class="settings-section-header">
        <div>
          <h2 id="diagnostics-title">自动化诊断</h2>
          <p>记录发布和平台作品同步的步骤、耗时、结果及失败截图引用。</p>
        </div>
      </header>
      <div class="runtime-settings-row">
        <div class="runtime-settings-status">
          <span>
            <strong>本地诊断日志</strong>
            <small>JSONL · 保留 14 天 · 日志与截图最多 100 MiB</small>
          </span>
        </div>
        <button
          class="secondary-button"
          type="button"
          disabled={opening}
          onClick={async () => {
            setOpening(true);
            try {
              await window.matrix.openAutomationLogDirectory();
              context.setStatus("已打开自动化日志目录");
            } catch (error) {
              context.setStatus(
                `无法打开日志目录：${error instanceof Error ? error.message : String(error)}`,
                "error",
              );
            } finally {
              setOpening(false);
            }
          }}
        >
          {opening ? "正在打开…" : "打开日志目录"}
        </button>
      </div>
    </section>
  );
}

function ApplicationUpdateSettings({
  currentVersion,
  checkPending,
  checkCompleted,
  feedback,
  availableVersion,
  downloadPending,
  onCheck,
  onDownload,
}: {
  currentVersion: string | null;
  checkPending: boolean;
  checkCompleted: boolean;
  feedback: UpdateCheckFeedback | null;
  availableVersion: string | null;
  downloadPending: boolean;
  onCheck(): void | Promise<void>;
  onDownload(version: string): void | Promise<void>;
}) {
  return (
    <section class="settings-surface" aria-labelledby="update-title">
      <header class="settings-section-header">
        <div>
          <h2 id="update-title">软件更新</h2>
          <p>检查是否有可供手动下载和安装的新版本。</p>
        </div>
      </header>
      <div class="update-settings-row">
        <span class="update-version">
          <strong>当前版本</strong>
          <small>{currentVersion ? `v${currentVersion}` : "正在读取…"}</small>
        </span>
        <span class="update-settings-actions">
          <button
            class="secondary-button"
            type="button"
            disabled={checkPending}
            onClick={() => void onCheck()}
          >
            {checkPending
              ? "正在检查…"
              : checkCompleted
                ? "重新检查"
                : "检查新版本"}
          </button>
          {availableVersion && (
            <button
              type="button"
              disabled={downloadPending}
              onClick={() => void onDownload(availableVersion)}
            >
              {downloadPending ? "正在打开…" : `下载 v${availableVersion}`}
            </button>
          )}
        </span>
      </div>
      {feedback && (
        <p
          class={`update-check-feedback${feedback.error ? " update-check-error" : ""}`}
          role={feedback.error ? "alert" : "status"}
        >
          {feedback.message}
        </p>
      )}
    </section>
  );
}

function RuntimeSettings({
  runtime,
  actionPending,
  error,
  onRunningChange,
}: {
  runtime: RuntimeSummary;
  actionPending: boolean;
  error: string | null;
  onRunningChange(running: boolean): void | Promise<void>;
}) {
  const running = runtime.status === "running";
  const loading = runtime.status === "loading";
  const statusLabel =
    runtime.status === "loading"
      ? "正在读取状态"
      : running
        ? "运行中"
        : runtime.status === "stopped"
          ? "已停止"
          : "状态未知";
  const endpoint =
    runtime.host && runtime.port ? `${runtime.host}:${runtime.port}` : "—";

  return (
    <section class="settings-surface" aria-labelledby="runtime-title">
      <header class="settings-section-header">
        <div>
          <h2 id="runtime-title">本地服务</h2>
          <p>允许 Web 端连接桌面应用并使用本机账号与发布能力。</p>
        </div>
      </header>
      <div class="runtime-settings-row">
        <div class="runtime-settings-status">
          <span
            class={`runtime-dot runtime-${runtime.status}`}
            aria-hidden="true"
          />
          <span>
            <strong>{statusLabel}</strong>
            <small>
              地址 {endpoint}
              {runtime.version ? ` · 版本 v${runtime.version}` : ""}
            </small>
          </span>
        </div>
        <button
          class={running ? "secondary-button runtime-stop-button" : undefined}
          type="button"
          disabled={loading || actionPending}
          onClick={() => void onRunningChange(!running)}
        >
          {actionPending ? "处理中…" : running ? "关闭服务" : "启动服务"}
        </button>
      </div>
      {error && (
        <p class="runtime-settings-error" role="alert">
          操作失败：{error}
        </p>
      )}
    </section>
  );
}

function ThemeOption({
  preference,
  label,
  detail,
  icon,
  selected,
  onSelect,
}: {
  preference: ThemePreference;
  label: string;
  detail: string;
  icon: "system" | "light" | "dark";
  selected: boolean;
  onSelect(preference: ThemePreference): void;
}) {
  return (
    <button
      class={`theme-option${selected ? " selected" : ""}`}
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => onSelect(preference)}
    >
      <span class={`theme-preview preview-${preference}`}>
        <span class="theme-preview-sidebar" />
        <span class="theme-preview-content">
          <i />
          <i />
          <i />
        </span>
      </span>
      <span class="theme-option-copy">
        <Icon name={icon} size={17} />
        <span>
          <strong>{label}</strong>
          <small>{detail}</small>
        </span>
        <span class="theme-check" aria-hidden="true">
          {selected && <Icon name="check" size={14} />}
        </span>
      </span>
    </button>
  );
}
