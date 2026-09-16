import type {
  PublicationSnapshot,
  PublicationRepository,
} from "@nedia-matrix/publishing";
import type { DesktopMetadataDatabase } from "../../persistence/desktop-metadata-database.js";
import { publicationSnapshot } from "../../persistence/metadata-validation.js";

export class SqlitePublicationRepository implements PublicationRepository {
  constructor(private readonly database: DesktopMetadataDatabase) {}

  private decode(row: Record<string, unknown>): PublicationSnapshot {
    const record = publicationSnapshot(JSON.parse(String(row.record)));
    if (record.publication.id !== row.id || record.requestId !== row.request_id)
      throw new Error("Publication index mismatch");
    return record;
  }
  list(): PublicationSnapshot[] {
    return this.database.connection
      .prepare("SELECT * FROM publications")
      .all()
      .map((row) => this.decode(row))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  get(id: string): PublicationSnapshot | undefined {
    const row = this.database.connection
      .prepare("SELECT * FROM publications WHERE id=?")
      .get(id);
    return row ? this.decode(row) : undefined;
  }
  findByRequestId(requestId: string): PublicationSnapshot | undefined {
    const row = this.database.connection
      .prepare("SELECT * FROM publications WHERE request_id=?")
      .get(requestId);
    return row ? this.decode(row) : undefined;
  }

  save(record: PublicationSnapshot): void {
    publicationSnapshot(record);
    this.database.connection
      .prepare(
        "INSERT INTO publications VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET request_id=excluded.request_id, record=excluded.record",
      )
      .run(record.publication.id, record.requestId, JSON.stringify(record));
  }
  remove(id: string): void {
    this.database.connection
      .prepare("DELETE FROM publications WHERE id=?")
      .run(id);
  }
}
