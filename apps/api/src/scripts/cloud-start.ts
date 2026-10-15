import "reflect-metadata";
import { Db } from "../db";
import { migrate } from "./migrate";
import { bootstrapAdmin } from "../bootstrap";
import { createApp } from "../main";
import { config } from "../config";
let phase = "configuration";
async function start() {
  const db = new Db();
  try {
    phase = "database-migration";
    await migrate(db);
    phase = "administrator-bootstrap";
    const created = await bootstrapAdmin(
      db,
      process.env.ADMIN_EMAIL,
      process.env.ADMIN_PASSWORD,
    );
    console.log(
      created
        ? "Initial administrator created"
        : "Existing administrator retained",
    );
  } finally {
    await db.onModuleDestroy();
  }
  phase = "application-initialization";
  const app = await createApp();
  phase = "http-listen";
  await app.listen(config().PORT, config().HOST);
}
start().catch((error: unknown) => {
  const diagnostic = error as { code?: unknown; name?: unknown; issues?: { path?: unknown[] }[] };
  const code = typeof diagnostic?.code === "string" && /^[A-Z0-9_]{2,50}$/.test(diagnostic.code)
    ? diagnostic.code : "UNCLASSIFIED";
  const name = typeof diagnostic?.name === "string" && /^[A-Za-z]{1,40}$/.test(diagnostic.name)
    ? diagnostic.name : "Error";
  console.error(
    `Cloud startup failed: phase=${phase}, type=${name}, code=${code}. No credential values logged.`,
  );
  process.exitCode = 1;
});
