import "reflect-metadata";
import { Db } from "../db";
import { migrate } from "./migrate";
import { bootstrapAdmin } from "../bootstrap";
import { createApp } from "../main";
import { config } from "../config";
async function start() {
  const db = new Db();
  try {
    await migrate(db);
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
  const app = await createApp();
  await app.listen(config().PORT, config().HOST);
}
start().catch(() => {
  console.error(
    "Cloud startup failed. Verify database, admin bootstrap settings, JWT secret and allowed origins.",
  );
  process.exitCode = 1;
});
