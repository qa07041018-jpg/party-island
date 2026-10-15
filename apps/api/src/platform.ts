import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  Req,
  UseGuards,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { z } from "zod";
import { Db } from "./db";
import { AuthGuard } from "./auth";
import { Rooms, RoomEvents } from "./rooms";
import { Presence } from "./realtime";
import { parse, idSchema } from "./security";
@Controller("lobby")
@UseGuards(AuthGuard)
export class LobbyController {
  constructor(
    private db: Db,
    private rooms: Rooms,
    private presence: Presence,
  ) {}
  @Get() async lobby(@Req() r: any) {
    const [wallet, rooms, announcements, currentRoom, online] =
      await Promise.all([
        this.db.query(
          "SELECT coins::text,diamonds::text FROM wallets WHERE user_id=$1",
          [r.user.id],
        ),
        this.rooms.list(r.user.id),
        this.db.query(
          "SELECT * FROM announcements ORDER BY published_at DESC LIMIT 10",
        ),
        this.rooms.current(r.user.id),
        this.presence.count(),
      ]);
    return {
      user: r.user,
      wallet: wallet.rows[0],
      rooms,
      currentRoom,
      online,
      announcements: announcements.rows,
      games: [
        { id: "social", name: "交友派對", available: true },
        { id: "undercover", name: "誰是臥底", available: false },
        { id: "drawing", name: "你畫我猜", available: false },
        { id: "werewolf", name: "狼人殺", available: false },
      ],
    };
  }
}
@Controller("admin")
@UseGuards(AuthGuard)
export class AdminController {
  constructor(
    private db: Db,
    private rooms: Rooms,
    private presence: Presence,
    private events: RoomEvents,
  ) {}
  private require(r: any) {
    if (r.user.role !== "admin")
      throw new ForbiddenException("需要系統管理員權限");
  }
  @Get("overview") async overview(@Req() r: any) {
    this.require(r);
    const [users, rooms, audit, online] = await Promise.all([
      this.db.query(
        "SELECT id,uid::text,email,nickname,role,status,is_guest,created_at FROM users ORDER BY created_at DESC LIMIT 100",
      ),
      this.db.query(
        "SELECT id,name,owner_id,state,game FROM rooms WHERE state<>'closed' ORDER BY created_at DESC LIMIT 100",
      ),
      this.db.query("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100"),
      this.presence.count(),
    ]);
    return { users: users.rows, rooms: rooms.rows, audit: audit.rows, online };
  }
  @Post("users/:id/status") async status(
    @Req() r: any,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    this.require(r);
    parse(idSchema, id);
    const b = parse(
      z
        .object({
          status: z.enum(["active", "suspended"]),
          reason: z.string().trim().min(3).max(500),
        })
        .strict(),
      body,
    );
    if (id === r.user.id) throw new ForbiddenException("不能停權自己");
    await this.db.tx(async (c) => {
      const target = await c.query(
        "SELECT role FROM users WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (!target.rowCount) throw new NotFoundException("玩家不存在");
      if (target.rows[0].role === "admin")
        throw new ForbiddenException("此版本不允許變更其他系統管理員");
      await c.query("UPDATE users SET status=$2 WHERE id=$1", [id, b.status]);
      if (b.status === "suspended")
        await c.query(
          "UPDATE refresh_sessions SET revoked_at=now() WHERE user_id=$1",
          [id],
        );
      await c.query(
        "INSERT INTO audit_logs(actor_id,action,target_id,detail) VALUES($1,'user.status',$2,$3)",
        [r.user.id, id, JSON.stringify(b)],
      );
    });
    if (b.status === "suspended") {
      const current = await this.rooms.current(id);
      if (current) await this.rooms.leave(id, current.id);
      await this.events.revokeUser(id);
    }
    return { ok: true };
  }
  @Post("announcements") async announce(@Req() r: any, @Body() body: unknown) {
    this.require(r);
    const b = parse(
      z
        .object({
          title: z.string().trim().min(1).max(80),
          body: z.string().trim().min(1).max(2000),
        })
        .strict(),
      body,
    );
    return this.db.tx(async (c) => {
      const a = await c.query(
        "INSERT INTO announcements(title,body) VALUES($1,$2) RETURNING *",
        [b.title, b.body],
      );
      await c.query(
        "INSERT INTO audit_logs(actor_id,action,target_id) VALUES($1,'announcement.create',$2)",
        [r.user.id, a.rows[0].id],
      );
      return a.rows[0];
    });
  }
}
