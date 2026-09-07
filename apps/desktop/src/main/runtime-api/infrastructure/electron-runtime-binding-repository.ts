import Store from "electron-store";

import type { RuntimeAccountBinding } from "../application/runtime-account-binding-service.js";

export type { RuntimeAccountBinding } from "../application/runtime-account-binding-service.js";

type RuntimeAccountBindingStoreSchema = {
  bindings?: unknown;
};

function parseBinding(value: unknown): RuntimeAccountBinding | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const binding = value as Partial<RuntimeAccountBinding>;
  if (
    typeof binding.platformAccountId !== "string" ||
    typeof binding.runtimeAccountId !== "string" ||
    typeof binding.platform !== "string" ||
    typeof binding.externalAccountId !== "string" ||
    typeof binding.boundAt !== "string"
  ) {
    return null;
  }
  return binding as RuntimeAccountBinding;
}

export function parseStoredRuntimeAccountBindings(
  value: unknown,
): RuntimeAccountBinding[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(parseBinding)
    .filter((binding): binding is RuntimeAccountBinding => binding !== null);
}

export class ElectronRuntimeBindingRepository {
  private readonly store = new Store<RuntimeAccountBindingStoreSchema>({
    name: "matrix-runtime-account-bindings",
  });

  list(): RuntimeAccountBinding[] {
    return parseStoredRuntimeAccountBindings(this.store.get("bindings")).sort(
      (left, right) => right.boundAt.localeCompare(left.boundAt),
    );
  }

  put(binding: RuntimeAccountBinding): void {
    const bindings = this.list().filter(
      (candidate) =>
        candidate.platformAccountId !== binding.platformAccountId &&
        candidate.runtimeAccountId !== binding.runtimeAccountId,
    );
    bindings.push(binding);
    this.store.set("bindings", bindings);
  }

  removeForRuntimeAccount(runtimeAccountId: string): void {
    this.store.set(
      "bindings",
      this.list().filter(
        (binding) => binding.runtimeAccountId !== runtimeAccountId,
      ),
    );
  }
}
