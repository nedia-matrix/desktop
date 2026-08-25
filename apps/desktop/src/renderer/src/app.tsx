import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

import type { AppContext, AppStatus } from "./app-context.js";
import { Icon, type IconName } from "./components/icons.js";
import { AccountsPage } from "./pages/accounts-page.js";
import { PublicationsPage } from "./pages/publications-page.js";
import { PublishPage } from "./pages/publish-page.js";
import { SettingsPage } from "./pages/settings-page.js";
import logoUrl from "../../../resources/logo.png";
import {
  applyTheme,
  loadThemePreference,
  resolveTheme,
  saveThemePreference,
} from "./theme.js";

interface RouteDefinition {
  path: string;
  title: string;
  icon: IconName;
  render(context: AppContext): ComponentChildren;
}

const routes: readonly RouteDefinition[] = [
  {
    path: "/accounts",
    title: "账号管理",
    icon: "accounts",
    render: (context) => <AccountsPage context={context} />,
  },
  {
    path: "/publish",
    title: "内容发布",
    icon: "publish",
    render: (context) => <PublishPage context={context} />,
  },
  {
    path: "/publications",
    title: "内容维护",
    icon: "content",
    render: (context) => <PublicationsPage context={context} />,
  },
  {
    path: "/settings",
    title: "设置",
    icon: "settings",
    render: (context) => <SettingsPage context={context} />,
  },
];

interface RuntimeSummary {
  version: string | null;
  status: "loading" | "running" | "stopped" | "unknown";
  host: "127.0.0.1" | null;
  port: number | null;
}

export function App({ context }: { context: AppContext }) {
  const [routePath, setRoutePath] = useState(routeFromHash);
  const [status, setStatus] = useState<AppStatus>(context.currentStatus());
  const [statusVisible, setStatusVisible] = useState(true);
  const [themePreference, setThemePreference] = useState(loadThemePreference);
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    () => globalThis.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [runtime, setRuntime] = useState<RuntimeSummary>({
    version: null,
    status: "loading",
    host: null,
    port: null,
  });
  const [runtimeActionPending, setRuntimeActionPending] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  const route = useMemo(
    () => routes.find(({ path }) => path === routePath) ?? routes[0]!,
    [routePath],
  );
  const resolvedTheme = resolveTheme(themePreference, systemPrefersDark);

  useEffect(() => {
    const updateRoute = () => setRoutePath(routeFromHash());
    globalThis.addEventListener("hashchange", updateRoute);
    if (!globalThis.location.hash) globalThis.location.hash = "/accounts";
    return () => globalThis.removeEventListener("hashchange", updateRoute);
  }, []);

  useEffect(() => context.onStatusUpdate(setStatus), [context]);

  useEffect(() => {
    setStatusVisible(true);
    const timeout = globalThis.setTimeout(() => setStatusVisible(false), 5_000);
    return () => globalThis.clearTimeout(timeout);
  }, [status]);

  useEffect(() => {
    const media = globalThis.matchMedia("(prefers-color-scheme: dark)");
    const updateSystemTheme = (event: MediaQueryListEvent) =>
      setSystemPrefersDark(event.matches);
    media.addEventListener("change", updateSystemTheme);
    return () => media.removeEventListener("change", updateSystemTheme);
  }, []);

  useEffect(() => {
    applyTheme(resolvedTheme);
    saveThemePreference(themePreference);
  }, [resolvedTheme, themePreference]);

  useEffect(() => {
    let active = true;
    const refreshRuntime = async () => {
      try {
        const summary = await window.matrix.getLocalRuntimeStatus();
        if (active) setRuntime(summary);
      } catch {
        if (active) {
          setRuntime({
            version: null,
            status: "unknown",
            host: null,
            port: null,
          });
        }
      }
    };
    void refreshRuntime();
    const interval = globalThis.setInterval(() => void refreshRuntime(), 2_000);
    return () => {
      active = false;
      globalThis.clearInterval(interval);
    };
  }, []);

  const setRuntimeRunning = async (running: boolean) => {
    setRuntimeActionPending(true);
    setRuntimeError(null);
    try {
      const summary = await window.matrix.setLocalRuntimeRunning({ running });
      setRuntime(summary);
      context.setStatus(running ? "本地服务已启动" : "本地服务已关闭");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRuntimeError(message);
      context.setStatus(
        running ? "本地服务启动失败" : "本地服务关闭失败",
        "error",
      );
    } finally {
      setRuntimeActionPending(false);
    }
  };

  return (
    <div class="app-shell">
      <header class="titlebar">
        <a class="brand" href="#/accounts" aria-label="Nedia Matrix 首页">
          <img class="brand-mark" src={logoUrl} alt="" />
          <span class="brand-name">
            <strong>Nedia Matrix</strong>
          </span>
          <span class="app-version">
            {runtime.version ? `v${runtime.version}` : "v—"}
          </span>
        </a>

        <div class="titlebar-heading">
          <h1>{route.title}</h1>
        </div>
        {statusVisible && (
          <output class={`global-status status-${status.kind}`}>
            <span class="status-indicator" aria-hidden="true" />
            {status.message}
          </output>
        )}
        <span class="titlebar-spacer" aria-hidden="true" />
        <button
          class="icon-button settings-shortcut"
          type="button"
          aria-label="前往设置"
          title="设置"
          onClick={() => {
            if (route.path === "/settings") globalThis.history.back();
            else globalThis.location.hash = "/settings";
          }}
        >
          <Icon name="settings" />
        </button>
      </header>

      <main class="app-main">
        <aside class="sidebar">
          <nav class="primary-navigation" aria-label="主导航">
            {routes.slice(0, 3).map((item) => (
              <NavigationLink item={item} active={item.path === route.path} />
            ))}
          </nav>
        </aside>

        <section class="workspace" key={route.path}>
          {route.path === "/settings" ? (
            <SettingsPage
              context={context}
              themePreference={themePreference}
              onThemePreferenceChange={setThemePreference}
              resolvedTheme={resolvedTheme}
              runtime={runtime}
              runtimeActionPending={runtimeActionPending}
              runtimeError={runtimeError}
              onRuntimeRunningChange={setRuntimeRunning}
            />
          ) : (
            route.render(context)
          )}
        </section>
      </main>
    </div>
  );
}

function NavigationLink({
  item,
  active,
}: {
  item: RouteDefinition;
  active: boolean;
}) {
  return (
    <a
      class={active ? "active" : undefined}
      href={`#${item.path}`}
      aria-current={active ? "page" : undefined}
    >
      <Icon name={item.icon} />
      <span>{item.title}</span>
    </a>
  );
}

function routeFromHash(): string {
  const path = globalThis.location.hash.slice(1) || "/accounts";
  return routes.some((route) => route.path === path) ? path : "/accounts";
}
