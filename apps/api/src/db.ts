import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Pool, PoolClient, QueryResultRow } from "pg";
import { config } from "./config";
@Injectable()
export class Db implements OnModuleDestroy {
  readonly pool = new Pool({
    connectionString: config().DATABASE_URL,
    max: 15,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  });
  query<T extends QueryResultRow = any>(sql: string, args: any[] = []) {
    return this.pool.query<T>(sql, args);
  }
  async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const r = await fn(c);
      await c.query("COMMIT");
      return r;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async onModuleDestroy() {
    await this.pool.end();
  }
}
