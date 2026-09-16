/** Tracks externally invoked use cases while observations finish independently. */
export class ApplicationCommandGate {
  private stopping = false;
  private readonly active = new Set<Promise<unknown>>();

  guard<T extends object>(useCases: T): T {
    return new Proxy(useCases, {
      get: (target, key, receiver) => {
        const method: unknown = Reflect.get(target, key, receiver);
        if (typeof method !== "function") return method;
        return (...args: unknown[]) => {
          if (this.stopping) throw new Error("Desktop is shutting down");
          const result: unknown = Reflect.apply(method, target, args);
          if (result instanceof Promise) {
            this.active.add(result);
            void result.then(
              () => this.active.delete(result),
              () => this.active.delete(result),
            );
          }
          return result;
        };
      },
    });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    await Promise.allSettled([...this.active]);
  }
}
