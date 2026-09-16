import { randomUUID } from "node:crypto";
import type { DesktopMetadataDatabase } from "./desktop-metadata-database.js";

export const metadataSchemaVersion = 2;

export function migrateMetadataSchema(
  database: DesktopMetadataDatabase,
  existed: boolean,
): void {
  const sql = database.connection;
  let version = Number(sql.prepare("PRAGMA user_version").get()?.user_version);
  if (version < 0 || version > metadataSchemaVersion)
    throw new Error("Unsupported metadata schema version");
  if (version === metadataSchemaVersion) {
    const migrations = sql
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all();
    if (
      migrations.length !== metadataSchemaVersion ||
      migrations.some((migration, index) => migration.version !== index + 1)
    )
      throw new Error("Invalid metadata migration history");
    return;
  }
  if (version === 0) {
    // An unversioned database with content is never an import destination.
    if (
      sql
        .prepare(
          "SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'",
        )
        .all().length
    ) {
      throw new Error("Unrecognized nonempty metadata database");
    }
    if (existed)
      database.backup(`${database.filename}.before-v1-${randomUUID()}.sqlite`);
    database.transaction(() => {
      sql.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, description TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;
      CREATE TABLE legacy_imports (source TEXT PRIMARY KEY, present INTEGER NOT NULL CHECK(present IN (0,1)), digest TEXT, source_version TEXT NOT NULL, count INTEGER NOT NULL, completed_at TEXT NOT NULL) STRICT;
      CREATE TABLE platform_accounts (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, platform_id TEXT NOT NULL, identity_scheme TEXT, external_account_id TEXT, lifecycle TEXT NOT NULL, record TEXT NOT NULL CHECK(json_valid(record))) STRICT;
      CREATE UNIQUE INDEX account_identity ON platform_accounts(platform_id, identity_scheme, external_account_id) WHERE lifecycle='active' AND identity_scheme IS NOT NULL AND external_account_id IS NOT NULL;
      CREATE INDEX account_profile ON platform_accounts(profile_id);
      CREATE TABLE account_replacement_aliases (id TEXT PRIMARY KEY, record TEXT NOT NULL CHECK(json_valid(record))) STRICT;
      CREATE TABLE retired_browser_profiles (id TEXT PRIMARY KEY, record TEXT NOT NULL CHECK(json_valid(record))) STRICT;
      CREATE TABLE runtime_account_bindings (platform_account_id TEXT PRIMARY KEY, runtime_account_id TEXT NOT NULL UNIQUE REFERENCES platform_accounts(id), record TEXT NOT NULL CHECK(json_valid(record))) STRICT;
      CREATE TABLE publications (id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, record TEXT NOT NULL CHECK(json_valid(record))) STRICT;
      CREATE TABLE publication_observation_inbox (event_id TEXT PRIMARY KEY, publication_id TEXT NOT NULL REFERENCES publications(id), sequence INTEGER NOT NULL CHECK(sequence >= 1), record TEXT NOT NULL CHECK(json_valid(record))) STRICT;
      PRAGMA user_version=1;
    `);
      sql
        .prepare("INSERT INTO schema_migrations VALUES (1, ?, ?)")
        .run("Initial desktop metadata", new Date().toISOString());
    });
    version = 1;
  }
  if (version === 1) {
    if (existed)
      database.backup(`${database.filename}.before-v2-${randomUUID()}.sqlite`);
    database.transaction(() => {
      sql.exec(`
        CREATE TABLE platform_contents (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES platform_accounts(id) ON DELETE CASCADE,
          external_content_id TEXT NOT NULL,
          record TEXT NOT NULL CHECK(json_valid(record)),
          UNIQUE(account_id, external_content_id)
        ) STRICT;
        CREATE INDEX platform_content_account ON platform_contents(account_id);
        CREATE TABLE platform_content_sync_runs (
          account_id TEXT PRIMARY KEY REFERENCES platform_accounts(id) ON DELETE CASCADE,
          record TEXT NOT NULL CHECK(json_valid(record))
        ) STRICT;
        PRAGMA user_version=2;
      `);
      sql
        .prepare("INSERT INTO schema_migrations VALUES (2, ?, ?)")
        .run(
          "Add platform content snapshots and sync runs",
          new Date().toISOString(),
        );
    });
  }
}
