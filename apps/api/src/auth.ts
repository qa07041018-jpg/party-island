import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Injectable,
  Post,
  UnauthorizedException,
  ConflictException,
  UseGuards,
  Get,
  Patch,
  Req,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { Db } from "./db";
import { config } from "./config";
import {
  digest,
  hashPassword,
  verifyPassword,
  opaque,
  parse,
  passwordSchema,
  nicknameSchema,
} from "./security";
export type Player = {
  id: string;
  uid: string;
  nickname: string;
  role: string;
  status: string;
  is_guest: boolean;
  experience: number;
  avatar_color: string;
};
const fields =
  "id,uid::text,nickname,role,status,is_guest,experience,avatar_color";
@Injectable()
export class Auth {
  constructor(private db: Db) {}
  async player(id: string): Promise<Player> {
    const r = await this.db.query(
      `SELECT ${fields} FROM users WHERE id=$1 AND status='active'`,
      [id],
    );
    if (!r.rows[0]) throw new UnauthorizedException("帳號無法使用");
    return r.rows[0];
  }
  async authenticate(token: string) {
    try {
      const p = jwt.verify(token, config().JWT_SECRET, {
        algorithms: ["HS256"],
        issuer: "party-island",
        audience: "island-client",
      }) as jwt.JwtPayload;
      if (
        typeof p.sub !== "string" ||
        p.kind !== "access" ||
        typeof p.exp !== "number"
      )
        throw Error();
      return await this.player(p.sub);
    } catch {
      throw new UnauthorizedException("登入已過期，請重新登入");
    }
  }
  async issue(user: Player, c: any = this.db, family = randomUUID()) {
    const refreshToken = opaque();
    await c.query(
      "INSERT INTO refresh_sessions(user_id,family,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '30 days')",
      [user.id, family, digest(refreshToken)],
    );
    const accessToken = jwt.sign({ kind: "access" }, config().JWT_SECRET, {
      algorithm: "HS256",
      subject: user.id,
      issuer: "party-island",
      audience: "island-client",
      expiresIn: "15m",
    });
    return { accessToken, refreshToken, user };
  }
  async register(body: unknown) {
    const b = parse(
      z
        .object({
          email: z
            .email()
            .max(254)
            .transform((s) => s.toLowerCase()),
          password: passwordSchema,
          nickname: nicknameSchema,
        })
        .strict(),
      body,
    );
    const hash = await hashPassword(b.password);
    try {
      return await this.db.tx(async (c) => {
        const r = await c.query(
          `INSERT INTO users(email,password_hash,nickname) VALUES($1,$2,$3) RETURNING ${fields}`,
          [b.email, hash, b.nickname],
        );
        await c.query("INSERT INTO wallets(user_id) VALUES($1)", [
          r.rows[0].id,
        ]);
        return this.issue(r.rows[0], c);
      });
    } catch (e: any) {
      if (e.code === "23505") throw new ConflictException("此電子信箱已註冊");
      throw e;
    }
  }
  async login(body: unknown) {
    const b = parse(
      z
        .object({
          email: z.email().transform((s) => s.toLowerCase()),
          password: z.string().min(1).max(128),
        })
        .strict(),
      body,
    );
    const r = await this.db.query("SELECT * FROM users WHERE email=$1", [
      b.email,
    ]);
    const u = r.rows[0];
    const valid = await verifyPassword(
      b.password,
      u?.password_hash ?? "00000000000000000000000000000000:" + "00".repeat(64),
    );
    if (!u || !valid || u.status !== "active")
      throw new UnauthorizedException("帳號或密碼不正確，或帳號無法使用");
    return this.issue(await this.player(u.id));
  }
  async guest(body: unknown) {
    const b = parse(z.object({ nickname: nicknameSchema }).strict(), body);
    return this.db.tx(async (c) => {
      const r = await c.query(
        `INSERT INTO users(nickname,is_guest) VALUES($1,true) RETURNING ${fields}`,
        [b.nickname],
      );
      await c.query("INSERT INTO wallets(user_id) VALUES($1)", [r.rows[0].id]);
      return this.issue(r.rows[0], c);
    });
  }
  async refresh(body: unknown) {
    const b = parse(
      z.object({ refreshToken: z.string().min(32).max(256) }).strict(),
      body,
    );
    // Commit revocation on replay BEFORE throwing; throwing inside tx would undo it.
    const result = await this.db.tx(async (c) => {
      const r = await c.query(
        "SELECT * FROM refresh_sessions WHERE token_hash=$1 FOR UPDATE",
        [digest(b.refreshToken)],
      );
      const s = r.rows[0];
      if (!s) return null;
      if (
        s.used_at ||
        s.revoked_at ||
        new Date(s.expires_at).getTime() <= Date.now()
      ) {
        await c.query(
          "UPDATE refresh_sessions SET revoked_at=now() WHERE family=$1",
          [s.family],
        );
        return null;
      }
      const u = await c.query(
        `SELECT ${fields} FROM users WHERE id=$1 AND status='active'`,
        [s.user_id],
      );
      if (!u.rowCount) return null;
      await c.query("UPDATE refresh_sessions SET used_at=now() WHERE id=$1", [
        s.id,
      ]);
      return this.issue(u.rows[0], c, s.family);
    });
    if (!result) throw new UnauthorizedException("工作階段已失效");
    return result;
  }
  async logout(body: unknown) {
    const b = parse(
      z.object({ refreshToken: z.string().min(32).max(256) }).strict(),
      body,
    );
    await this.db.query(
      "UPDATE refresh_sessions SET revoked_at=now() WHERE family IN (SELECT family FROM refresh_sessions WHERE token_hash=$1)",
      [digest(b.refreshToken)],
    );
    return { ok: true };
  }
}
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private auth: Auth) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const h = req.headers.authorization;
    if (!h?.startsWith("Bearer ")) throw new UnauthorizedException("請先登入");
    req.user = await this.auth.authenticate(h.slice(7));
    return true;
  }
}
@Controller("auth")
export class AuthController {
  constructor(private auth: Auth) {}
  @Post("register") register(@Body() b: unknown) {
    return this.auth.register(b);
  }
  @Post("login") login(@Body() b: unknown) {
    return this.auth.login(b);
  }
  @Post("guest") guest(@Body() b: unknown) {
    return this.auth.guest(b);
  }
  @Post("refresh") refresh(@Body() b: unknown) {
    return this.auth.refresh(b);
  }
  @Post("logout") logout(@Body() b: unknown) {
    return this.auth.logout(b);
  }
}
@Controller("me")
@UseGuards(AuthGuard)
export class MeController {
  constructor(private db: Db) {}
  @Get() me(@Req() r: any) {
    return r.user;
  }
  @Patch() async edit(@Req() r: any, @Body() body: unknown) {
    const b = parse(
      z
        .object({
          nickname: nicknameSchema,
          avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        })
        .strict(),
      body,
    );
    const q = await this.db.query(
      `UPDATE users SET nickname=$2,avatar_color=$3 WHERE id=$1 RETURNING ${fields}`,
      [r.user.id, b.nickname, b.avatarColor],
    );
    return q.rows[0];
  }
}
