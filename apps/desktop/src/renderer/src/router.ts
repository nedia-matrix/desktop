import type { AppContext } from "./app-context.js";
import { errorMessage } from "./shared.js";

export interface PageInstance {
  mount(container: HTMLElement): void | Promise<void>;
  unmount(): void;
}

export interface PageDefinition {
  title: string;
  description: string;
  create(context: AppContext): PageInstance;
}

interface RouterElements {
  content: HTMLElement;
  description: HTMLElement;
  navigation: HTMLElement;
  title: HTMLElement;
}

export class HashRouter {
  private currentPage: PageInstance | undefined;
  private navigationSequence = 0;

  constructor(
    private readonly elements: RouterElements,
    private readonly context: AppContext,
    private readonly routes: Readonly<Record<string, PageDefinition>>,
  ) {}

  start(): void {
    window.addEventListener("hashchange", () => void this.navigate());
    if (!this.routeFromHash()) {
      window.location.hash = "/accounts";
      return;
    }
    void this.navigate();
  }

  private routeFromHash(): string | undefined {
    const route = window.location.hash.slice(1) || "/accounts";
    return this.routes[route] ? route : undefined;
  }

  private async navigate(): Promise<void> {
    const route = this.routeFromHash();
    if (!route) {
      window.location.hash = "/accounts";
      return;
    }

    const sequence = ++this.navigationSequence;
    const definition = this.routes[route]!;
    this.currentPage?.unmount();
    this.elements.content.replaceChildren();
    this.elements.title.textContent = definition.title;
    this.elements.description.textContent = definition.description;
    this.updateNavigation(route);

    const page = definition.create(this.context);
    this.currentPage = page;
    try {
      await page.mount(this.elements.content);
      if (sequence !== this.navigationSequence) page.unmount();
    } catch (error) {
      if (sequence !== this.navigationSequence) return;
      this.context.setStatus(errorMessage(error, "页面加载失败"), "error");
      const message = document.createElement("p");
      message.className = "empty-state error-state";
      message.textContent = "页面加载失败，请稍后重试。";
      this.elements.content.replaceChildren(message);
    }
  }

  private updateNavigation(route: string): void {
    for (const link of this.elements.navigation.querySelectorAll("a")) {
      const active = link.getAttribute("href") === `#${route}`;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
  }
}
