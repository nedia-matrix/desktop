import type { DesktopMetadataDatabase } from "../../persistence/desktop-metadata-database.js";
import {
  RuntimeAccountBinding as RuntimeAccountBindingDomain,
  type RuntimeAccountBindingSnapshot,
} from "@nedia-matrix/runtime-account-binding";
import { object } from "../../persistence/metadata-validation.js";

export function bindingRecord(value: unknown): RuntimeAccountBindingSnapshot {
  const record = object(value);
  for (const key of [
    "platformAccountId",
    "runtimeAccountId",
    "platform",
    "externalAccountId",
    "boundAt",
  ]) {
    if (typeof record[key] !== "string" || !record[key])
      throw new Error("Invalid runtime binding");
  }
  return RuntimeAccountBindingDomain.rehydrate(
    record as unknown as RuntimeAccountBindingSnapshot,
  ).toSnapshot();
}

export class SqliteRuntimeBindingRepository {
  constructor(private readonly database: DesktopMetadataDatabase) {}
  list(): RuntimeAccountBindingSnapshot[] {
    return this.database.connection
      .prepare("SELECT * FROM runtime_account_bindings")
      .all()
      .map((row) => {
        const record = bindingRecord(JSON.parse(String(row.record)));
        if (
          record.platformAccountId !== row.platform_account_id ||
          record.runtimeAccountId !== row.runtime_account_id
        )
          throw new Error("Binding index mismatch");
        return record;
      })
      .sort((a, b) => b.boundAt.localeCompare(a.boundAt));
  }
  put(binding: RuntimeAccountBindingSnapshot): void {
    const normalized =
      RuntimeAccountBindingDomain.rehydrate(binding).toSnapshot();
    this.database.transaction(() => {
      this.database.connection
        .prepare(
          "DELETE FROM runtime_account_bindings WHERE platform_account_id=? OR runtime_account_id=?",
        )
        .run(normalized.platformAccountId, normalized.runtimeAccountId);
      this.database.connection
        .prepare("INSERT INTO runtime_account_bindings VALUES (?, ?, ?)")
        .run(
          normalized.platformAccountId,
          normalized.runtimeAccountId,
          JSON.stringify(normalized),
        );
    });
  }
  removeForRuntimeAccount(id: string): void {
    this.database.connection
      .prepare(
        "DELETE FROM runtime_account_bindings WHERE runtime_account_id=?",
      )
      .run(id);
  }
}
