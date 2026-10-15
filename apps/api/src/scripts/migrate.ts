import "reflect-metadata";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Db } from "../db";
export async function migrate(db: Db) {
  await db.tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(780126)");
    await c.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const r = await c.query(
      "SELECT 1 FROM schema_migrations WHERE version='001'",
    );
    if (!r.rowCount) {
      await c.query(
        await readFile(
          resolve(__dirname, "../../../../database/001_initial.sql"),
          "utf8",
        ),
      );
      await c.query("INSERT INTO schema_migrations(version) VALUES ('001')");
    }
  });
}
if (require.main === module) {
  const db = new Db();
  migrate(db)
    .then(() => console.log("Database migration complete"))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => db.onModuleDestroy());
}
