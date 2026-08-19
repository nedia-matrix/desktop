import { AppContext } from "./app-context.js";
import { createAccountsPage } from "./pages/accounts-page.js";
import { createDiagnosticsPage } from "./pages/diagnostics-page.js";
import { createPublicationsPage } from "./pages/publications-page.js";
import { createPublishPage } from "./pages/publish-page.js";
import { HashRouter, type PageDefinition } from "./router.js";
import { requireElement } from "./shared.js";

const status = requireElement<HTMLOutputElement>(document, "#status");
const context = new AppContext(status);
await context.initialize();

const versionOutput = requireElement<HTMLElement>(document, "#app-version");
try {
  const diagnostics = await window.matrix.getLocalRuntimeDiagnostics();
  versionOutput.textContent = diagnostics.version
    ? `版本 ${diagnostics.version}`
    : "版本未知";
} catch {
  versionOutput.textContent = "版本未知";
}

const routes: Readonly<Record<string, PageDefinition>> = {
  "/accounts": {
    title: "账号管理",
    description: "连接并维护相互隔离的持久化平台账号。",
    create: createAccountsPage,
  },
  "/publish": {
    title: "内容发布",
    description: "选择目标账号和媒体，准备草稿并提交到平台。",
    create: createPublishPage,
  },
  "/publications": {
    title: "发布历史",
    description: "查看每次发布的持久化状态、结果与平台链接。",
    create: createPublicationsPage,
  },
  "/diagnostics": {
    title: "服务诊断",
    description: "检查本机 HTTP 服务状态及经过脱敏的请求日志。",
    create: createDiagnosticsPage,
  },
};

new HashRouter(
  {
    content: requireElement(document, "#page-content"),
    description: requireElement(document, "#page-description"),
    navigation: requireElement(document, "#primary-navigation"),
    title: requireElement(document, "#page-title"),
  },
  context,
  routes,
).start();
