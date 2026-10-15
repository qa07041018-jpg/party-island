import {
  Body,
  Controller,
  ForbiddenException,
  ConflictException,
  NotFoundException,
  Injectable,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import { Db } from "./db";
import { AuthGuard } from "./auth";
import { parse, hashPassword, verifyPassword, idSchema } from "./security";
@Injectable()
export class RoomEvents {
  notify: (id: string) => Promise<void> = async () => {};
  evict: (room: string, user: string) => Promise<void> = async () => {};
  revokeUser: (user: string) => Promise<void> = async () => {};
}
@Injectable()
export class Rooms {
  constructor(
    private db: Db,
    private events: RoomEvents,
  ) {}
  async list(user: string) {
    return (
      await this.db.query(
        `SELECT r.id,r.name,r.owner_id,r.visibility,r.capacity,r.game,r.state,r.notice,r.created_at,(r.password_hash IS NOT NULL) AS locked,count(m.user_id)::int AS members FROM rooms r LEFT JOIN room_members m ON m.room_id=r.id WHERE r.state<>'closed' AND (r.visibility='public' OR EXISTS(SELECT 1 FROM room_members x WHERE x.room_id=r.id AND x.user_id=$1)) GROUP BY r.id ORDER BY r.created_at DESC LIMIT 100`,
        [user],
      )
    ).rows;
  }
  async current(user: string) {
    const q = await this.db.query(
      "SELECT room_id FROM room_members WHERE user_id=$1",
      [user],
    );
    return q.rows[0] ? this.snapshot(q.rows[0].room_id) : null;
  }
  async member(room: string, user: string) {
    const q = await this.db.query(
      "SELECT 1 FROM room_members m JOIN users u ON u.id=m.user_id WHERE m.room_id=$1 AND m.user_id=$2 AND u.status='active'",
      [room, user],
    );
    if (!q.rowCount) throw new ForbiddenException("你不在此房間");
  }
  async snapshot(id: string) {
    const q = await this.db.query(
      "SELECT id,name,owner_id,visibility,capacity,game,state,notice FROM rooms WHERE id=$1",
      [id],
    );
    if (!q.rowCount) throw new NotFoundException("房間不存在");
    const members = (
      await this.db.query(
        "SELECT m.user_id,m.seat,u.uid::text,u.nickname,u.avatar_color FROM room_members m JOIN users u ON u.id=m.user_id WHERE room_id=$1 ORDER BY seat",
        [id],
      )
    ).rows;
    const messages = (
      await this.db.query(
        "SELECT m.id::text,m.user_id,m.body,m.created_at,u.nickname FROM room_messages m JOIN users u ON u.id=m.user_id WHERE room_id=$1 ORDER BY m.id DESC LIMIT 50",
        [id],
      )
    ).rows.reverse();
    return { ...q.rows[0], members, messages };
  }
  async create(user: string, body: unknown) {
    const b = parse(
      z
        .object({
          name: z.string().trim().min(2).max(48),
          visibility: z.enum(["public", "private"]),
          capacity: z.number().int().min(2).max(12),
          game: z.enum(["social"]).default("social"),
          password: z.string().min(4).max(64).optional(),
        })
        .strict(),
      body,
    );
    const hash = b.password ? await hashPassword(b.password) : null;
    let id: string;
    try {
      id = await this.db.tx(async (c) => {
        await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [user]);
        if (
          (await c.query("SELECT 1 FROM room_members WHERE user_id=$1", [user]))
            .rowCount
        )
          throw new ConflictException("請先離開目前房間");
        const r = await c.query(
          "INSERT INTO rooms(name,owner_id,visibility,capacity,game,password_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
          [b.name, user, b.visibility, b.capacity, b.game, hash],
        );
        await c.query(
          "INSERT INTO room_members(room_id,user_id,seat) VALUES($1,$2,1)",
          [r.rows[0].id, user],
        );
        return r.rows[0].id;
      });
    } catch (e: any) {
      if (e.code === "23505") throw new ConflictException("請先離開目前房間");
      throw e;
    }
    await this.events.notify(id);
    return this.snapshot(id);
  }
  async join(user: string, id: string, body: unknown) {
    parse(idSchema, id);
    const b = parse(
      z.object({ password: z.string().max(64).optional() }).strict(),
      body,
    );
    try {
      await this.db.tx(async (c) => {
        await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [user]);
        const q = await c.query(
          "SELECT * FROM rooms WHERE id=$1 AND state='waiting' FOR UPDATE",
          [id],
        );
        const r = q.rows[0];
        if (!r) throw new NotFoundException("房間不存在或無法加入");
        const existing = await c.query(
          "SELECT room_id FROM room_members WHERE user_id=$1",
          [user],
        );
        if (existing.rows[0]?.room_id === id) return;
        if (existing.rowCount) throw new ConflictException("請先離開目前房間");
        if (
          (
            await c.query(
              "SELECT 1 FROM room_bans WHERE room_id=$1 AND user_id=$2",
              [id, user],
            )
          ).rowCount
        )
          throw new ForbiddenException("無法加入此房間");
        if (
          r.password_hash &&
          !(await verifyPassword(b.password ?? "", r.password_hash))
        )
          throw new ForbiddenException("房間密碼錯誤");
        const seats = (
          await c.query("SELECT seat FROM room_members WHERE room_id=$1", [id])
        ).rows.map((x) => x.seat);
        const seat = Array.from({ length: r.capacity }, (_, i) => i + 1).find(
          (s) => !seats.includes(s),
        );
        if (!seat) throw new ConflictException("房間已滿");
        await c.query(
          "INSERT INTO room_members(room_id,user_id,seat) VALUES($1,$2,$3)",
          [id, user, seat],
        );
      });
    } catch (e: any) {
      if (e.code === "23505") throw new ConflictException("你已在其他房間");
      throw e;
    }
    await this.events.notify(id);
    return this.snapshot(id);
  }
  async leave(user: string, id: string) {
    parse(idSchema, id);
    await this.db.tx(async (c) => {
      const q = await c.query(
        "SELECT owner_id FROM rooms WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (!q.rowCount) throw new NotFoundException("房間不存在");
      await c.query(
        "DELETE FROM room_members WHERE room_id=$1 AND user_id=$2",
        [id, user],
      );
      if (q.rows[0].owner_id === user) {
        const n = await c.query(
          "SELECT user_id FROM room_members WHERE room_id=$1 ORDER BY joined_at,user_id LIMIT 1",
          [id],
        );
        if (n.rowCount)
          await c.query("UPDATE rooms SET owner_id=$2 WHERE id=$1", [
            id,
            n.rows[0].user_id,
          ]);
        else await c.query("UPDATE rooms SET state='closed' WHERE id=$1", [id]);
      }
    });
    await this.events.evict(id, user);
    await this.events.notify(id);
    return { ok: true };
  }
  async kick(actor: string, id: string, body: unknown) {
    parse(idSchema, id);
    const b = parse(z.object({ userId: idSchema }).strict(), body);
    await this.db.tx(async (c) => {
      const r = await c.query(
        "SELECT owner_id FROM rooms WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (r.rows[0]?.owner_id !== actor || actor === b.userId)
        throw new ForbiddenException("僅房主可移除其他玩家");
      await c.query(
        "INSERT INTO room_bans(room_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [id, b.userId],
      );
      await c.query(
        "DELETE FROM room_members WHERE room_id=$1 AND user_id=$2",
        [id, b.userId],
      );
    });
    await this.events.evict(id, b.userId);
    await this.events.notify(id);
    return { ok: true };
  }
  async chat(user: string, id: string, body: unknown) {
    parse(idSchema, id);
    const b = parse(
      z.object({ body: z.string().trim().min(1).max(500) }).strict(),
      body,
    );
    await this.db.tx(async (c) => {
      await c.query("SELECT id FROM rooms WHERE id=$1 FOR UPDATE", [id]);
      if (
        !(
          await c.query(
            "SELECT 1 FROM room_members m JOIN users u ON u.id=m.user_id WHERE m.room_id=$1 AND m.user_id=$2 AND u.status='active'",
            [id, user],
          )
        ).rowCount
      )
        throw new ForbiddenException("你不在此房間");
      await c.query(
        "INSERT INTO room_messages(room_id,user_id,body) VALUES($1,$2,$3)",
        [id, user, b.body],
      );
    });
    await this.events.notify(id);
    return { ok: true };
  }
}
@Controller("rooms")
@UseGuards(AuthGuard)
export class RoomsController {
  constructor(private rooms: Rooms) {}
  @Get() list(@Req() r: any) {
    return this.rooms.list(r.user.id);
  }
  @Get("current") current(@Req() r: any) {
    return this.rooms.current(r.user.id);
  }
  @Get(":id") async one(@Req() r: any, @Param("id") id: string) {
    parse(idSchema, id);
    await this.rooms.member(id, r.user.id);
    return this.rooms.snapshot(id);
  }
  @Post() create(@Req() r: any, @Body() b: unknown) {
    return this.rooms.create(r.user.id, b);
  }
  @Post(":id/join") join(
    @Req() r: any,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.rooms.join(r.user.id, id, b);
  }
  @Post(":id/leave") leave(@Req() r: any, @Param("id") id: string) {
    return this.rooms.leave(r.user.id, id);
  }
  @Post(":id/kick") kick(
    @Req() r: any,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return this.rooms.kick(r.user.id, id, b);
  }
}
