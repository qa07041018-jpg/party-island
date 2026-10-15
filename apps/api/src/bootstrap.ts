import { Db } from "./db";
import { hashPassword, passwordSchema, parse } from "./security";
import { z } from "zod";
// First deployment only. Never promotes an existing player or resets a password.
export async function bootstrapAdmin(
  db: Db,
  email: unknown,
  password: unknown,
) {
  return db.tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(780127)");
    if (
      (await c.query("SELECT 1 FROM users WHERE role='admin' LIMIT 1")).rowCount
    )
      return false;
    const validEmail = parse(z.email(), email).toLowerCase();
    const validPassword = parse(passwordSchema, password);
    const hash = await hashPassword(validPassword);
    const r = await c.query(
      "INSERT INTO users(email,password_hash,nickname,role) VALUES($1,$2,'島主','admin') RETURNING id",
      [validEmail, hash],
    );
    await c.query("INSERT INTO wallets(user_id) VALUES($1)", [r.rows[0].id]);
    await c.query(
      "INSERT INTO audit_logs(actor_id,action,target_id) VALUES($1,'system.bootstrap',$1)",
      [r.rows[0].id],
    );
    return true;
  });
}
