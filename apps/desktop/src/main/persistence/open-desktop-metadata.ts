import { join } from "node:path";
import { DesktopMetadataDatabase } from "./desktop-metadata-database.js";
import { importLegacyStores } from "./legacy-store-import.js";
import { SqliteAccountRepository } from "../accounts/infrastructure/sqlite-account-repository.js";
import { SqlitePublicationRepository } from "../publishing/infrastructure/sqlite-publication-repository.js";
import { SqlitePublicationObservationInbox } from "../publishing/infrastructure/sqlite-publication-observation-inbox.js";
import { SqliteRuntimeBindingRepository } from "../runtime-api/infrastructure/sqlite-runtime-binding-repository.js";
import { SqlitePlatformContentRepository } from "../platform-content/infrastructure/sqlite-platform-content-repository.js";

export function openDesktopMetadata(directory: string) {
  const database = new DesktopMetadataDatabase(
    join(directory, "matrix-metadata.sqlite"),
  );
  try {
    const importReport = importLegacyStores(database, directory);
    const accounts = new SqliteAccountRepository(database);
    const publications = new SqlitePublicationRepository(database);
    const inbox = new SqlitePublicationObservationInbox(database);
    const bindings = new SqliteRuntimeBindingRepository(database);
    const platformContents = new SqlitePlatformContentRepository(database);
    return {
      database,
      accounts,
      publications,
      inbox,
      bindings,
      platformContents,
      importReport,
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
