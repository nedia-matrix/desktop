import type { PlatformModule } from "@nedia-matrix/platform-sdk";
import { douyinPlatformModule } from "@nedia-matrix/platform-douyin";
import { kuaishouPlatformModule } from "@nedia-matrix/platform-kuaishou";
import { xiaohongshuPlatformModule } from "@nedia-matrix/platform-xiaohongshu";
import { toPlatformSummary } from "./platform-summary.js";
import type { PlatformSummary } from "../../bridge/contracts.js";

const registeredModules: PlatformModule[] = [
  douyinPlatformModule,
  xiaohongshuPlatformModule,
  kuaishouPlatformModule,
];

export interface PlatformRegistry {
  get(id: string): PlatformModule | undefined;
  require(id: string): PlatformModule;
  list(): readonly PlatformModule[];
}

class DesktopPlatformRegistry implements PlatformRegistry {
  private readonly modules = new Map<string, PlatformModule>();

  constructor(modules: readonly PlatformModule[]) {
    for (const module of modules) {
      if (this.modules.has(module.id)) {
        throw new TypeError(`Platform is already registered: ${module.id}`);
      }
      this.modules.set(module.id, module);
    }
  }

  get(id: string): PlatformModule | undefined {
    return this.modules.get(id);
  }

  require(id: string): PlatformModule {
    const module = this.get(id);
    if (!module) throw new TypeError(`Platform is not registered: ${id}`);
    return module;
  }

  list(): readonly PlatformModule[] {
    return [...this.modules.values()];
  }
}

export function createPlatformRegistry(
  modules: readonly PlatformModule[],
): PlatformRegistry {
  return new DesktopPlatformRegistry(modules);
}

export interface PlatformCatalogHost extends PlatformRegistry {
  replace(modules: readonly PlatformModule[]): void;
}

class DesktopPlatformCatalogHost implements PlatformCatalogHost {
  private snapshot: PlatformRegistry;

  constructor(modules: readonly PlatformModule[]) {
    this.snapshot = createPlatformRegistry(modules);
  }

  get(id: string): PlatformModule | undefined {
    return this.snapshot.get(id);
  }

  require(id: string): PlatformModule {
    return this.snapshot.require(id);
  }

  list(): readonly PlatformModule[] {
    return this.snapshot.list();
  }

  replace(modules: readonly PlatformModule[]): void {
    const next = createPlatformRegistry(modules);
    this.snapshot = next;
  }
}

export function createPlatformCatalogHost(
  modules: readonly PlatformModule[],
): PlatformCatalogHost {
  return new DesktopPlatformCatalogHost(modules);
}

export const desktopPlatformCatalog: PlatformCatalogHost =
  createPlatformCatalogHost(registeredModules);

export const desktopPlatformRegistry: PlatformRegistry = desktopPlatformCatalog;

export function desktopPlatformSummaries(): PlatformSummary[] {
  return desktopPlatformCatalog.list().map(toPlatformSummary);
}
