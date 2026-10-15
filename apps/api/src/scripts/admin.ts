import "reflect-metadata";
import { Db } from "../db";
import { hashPassword, passwordSchema, parse } from "../security";
import { z } from "zod";
async function run() {
  const email = parse(z.email(), process.env.ADMIN_EMAIL).toLowerCase();
  const password = parse(passwordSchema, process.env.ADMIN_PASSWORD);
  const db = new Db();
  try {
    const hash = await hashPassword(password);
    await db.tx(async (c) => {
      const r = await c.query(
        "INSERT INTO users(email,password_hash,nickname,role) VALUES($1,$2,'系統管理員','admin') RETURNING id",
        [email, hash],
      );
      await c.query("INSERT INTO wallets(user_id) VALUES($1)", [r.rows[0].id]);
    });
    console.log(
      "Administrator created. Remove ADMIN_PASSWORD from environment.",
    );
  } finally {
    await db.onModuleDestroy();
  }
}
run().catch(() => {
  console.error(
    "Unable to create administrator. Check email uniqueness, password length and database connection.",
  );
  process.exitCode = 1;
});
