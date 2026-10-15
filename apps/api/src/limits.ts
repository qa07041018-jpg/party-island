import { Injectable, HttpException } from "@nestjs/common";
import { Db } from "./db";
import { digest } from "./security";
@Injectable()
export class Limits {
  constructor(private db: Db) {}
  async check(key: string, limit: number, seconds: number) {
    const r = await this.db.query(
      `INSERT INTO rate_limits(key,hits,reset_at) VALUES($1,1,now()+$2*interval '1 second') ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN rate_limits.reset_at<now() THEN 1 ELSE rate_limits.hits+1 END,reset_at=CASE WHEN rate_limits.reset_at<now() THEN now()+$2*interval '1 second' ELSE rate_limits.reset_at END RETURNING hits`,
      [digest(key), seconds],
    );
    if (r.rows[0].hits > limit)
      throw new HttpException("操作太頻繁，請稍後再試", 429);
  }
}
