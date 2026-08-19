import type { PlatformModule } from "./platform-module.js";

export class PlatformRegistry {
  private readonly modules = new Map<string, PlatformModule>();

  constructor(modules: readonly PlatformModule[]) {
    for (const module of modules) {
      const id = module.id;
      if (this.modules.has(id)) {
        throw new TypeError(`Platform is already registered: ${id}`);
      }
      this.modules.set(id, module);
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
