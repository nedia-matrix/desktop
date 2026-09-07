import type {
  PublicationRecord,
  PublicationRepository,
} from "@nedia-matrix/application-publishing";
import Store from "electron-store";

import {
  assertSupportedPublicationStoreVersion,
  mergeStoredPublication,
  parseStoredPublications,
  publicationStoreSchemaVersion,
  removeStoredPublication,
} from "./publication-state-codec.js";

export {
  assertSupportedPublicationStoreVersion,
  mergeStoredPublication,
  parseStoredPublications,
  publicationStoreSchemaVersion,
  removeStoredPublication,
  toPublicationSummary,
} from "./publication-state-codec.js";

type PublicationStoreSchema = {
  schemaVersion?: unknown;
  publications?: unknown;
};

export class ElectronPublicationRepository implements PublicationRepository {
  private readonly store = new Store<PublicationStoreSchema>({
    name: "matrix-publications",
  });

  list(): PublicationRecord[] {
    assertSupportedPublicationStoreVersion(this.store.get("schemaVersion"));
    return parseStoredPublications(this.store.get("publications")).sort(
      (left, right) => right.createdAt.localeCompare(left.createdAt),
    );
  }

  get(publicationId: string): PublicationRecord | undefined {
    return this.list().find(
      (record) => record.publication.id === publicationId,
    );
  }

  save(record: PublicationRecord): void {
    assertSupportedPublicationStoreVersion(this.store.get("schemaVersion"));
    const records = mergeStoredPublication(
      this.store.get("publications"),
      record,
    );
    this.store.set("schemaVersion", publicationStoreSchemaVersion);
    this.store.set("publications", records);
  }

  remove(publicationId: string): void {
    assertSupportedPublicationStoreVersion(this.store.get("schemaVersion"));
    const records = removeStoredPublication(
      this.store.get("publications"),
      publicationId,
    );
    this.store.set("schemaVersion", publicationStoreSchemaVersion);
    this.store.set("publications", records);
  }
}
